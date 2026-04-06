import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { readSpecIndex, readSpecFile, writeDriftResults, type DriftResult } from "@/lib/server/spec";
import { runToolEnabledStream } from "@/lib/server/sdk-helpers";
import { getSpecJob, setSpecJob, updateSpecJob, clearSpecJob } from "@/lib/server/spec-jobs";
import { buildSpecValidationPrompt } from "@/lib/server/prompts/spec";

/**
 * POST: Start spec validation as a background job.
 * Returns immediately. Frontend polls GET /api/apps/:id/spec/job for status.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    const numericAppId = Number(appId);
    const app = dal.getApp(numericAppId);
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    const existing = getSpecJob(numericAppId);
    if (existing && existing.status === "running") {
      const ageMs = Date.now() - existing.started_at;
      if (ageMs < 10 * 60 * 1000) {
        return NextResponse.json({ detail: "A spec job is already running" }, { status: 409 });
      }
      clearSpecJob(numericAppId);
    }

    const directory = app.directory;
    const specIndex = readSpecIndex(directory);
    if (!specIndex || specIndex.entries.length === 0) {
      return NextResponse.json({ detail: "No spec to validate" }, { status: 400 });
    }

    setSpecJob(numericAppId, {
      type: "validate",
      status: "running",
      progress: "Starting...",
      error: null,
      result: null,
      started_at: Date.now(),
    });

    // Fire and forget
    runValidateJob(numericAppId, directory, app.name, specIndex).catch(() => {});

    return NextResponse.json({ started: true, type: "validate" });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

async function runValidateJob(
  appId: number,
  directory: string,
  appName: string,
  specIndex: { appName: string; entries: { path: string; summary: string }[] }
): Promise<void> {
  try {
    const specSummary = specIndex.entries
      .map((e) => {
        const content = readSpecFile(directory, e.path);
        return content ? `## ${e.path}\n${content.slice(0, 800)}` : null;
      })
      .filter(Boolean)
      .join("\n\n---\n\n")
      .slice(0, 6000);

    const filePaths = specIndex.entries.map((e) => e.path);

    const prompt = buildSpecValidationPrompt({ appName, directory, specSummary, filePaths });

    updateSpecJob(appId, { progress: "Exploring codebase..." });

    let resultText = "";
    const toolStream = runToolEnabledStream(prompt, {
      category: "background",
      cwd: directory,
    });

    for await (const event of toolStream) {
      if (event.type === "tool_use") {
        updateSpecJob(appId, { progress: `Checking: ${event.detail.slice(0, 100)}` });
      } else if (event.type === "text") {
        updateSpecJob(appId, { progress: event.detail.slice(0, 100) });
      } else if (event.type === "result" && event.resultText) {
        resultText = event.resultText;
      }
    }

    if (!resultText) {
      updateSpecJob(appId, { status: "failed", error: "No result from validation" });
      return;
    }

    updateSpecJob(appId, { progress: "Parsing results..." });

    let results: DriftResult[];
    try {
      const cleaned = resultText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      results = JSON.parse(cleaned).results;
    } catch {
      const match = resultText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          results = JSON.parse(match[0]).results;
        } catch {
          updateSpecJob(appId, { status: "failed", error: "Failed to parse validation output" });
          return;
        }
      } else {
        updateSpecJob(appId, { status: "failed", error: "Failed to parse validation output" });
        return;
      }
    }

    if (!results || !Array.isArray(results)) {
      updateSpecJob(appId, { status: "failed", error: "Invalid validation results" });
      return;
    }

    writeDriftResults(directory, results);

    const drifted = results.filter((r) => r.status === "drifted").length;
    const missing = results.filter((r) => r.status === "missing").length;
    const ok = results.filter((r) => r.status === "ok").length;

    updateSpecJob(appId, {
      status: "completed",
      progress: `${ok} ok, ${drifted} drifted, ${missing} missing`,
      result: { results },
    });
  } catch (e: any) {
    updateSpecJob(appId, { status: "failed", error: e.message || String(e) });
  }
}
