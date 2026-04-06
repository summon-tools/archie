import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { runToolEnabledStream } from "@/lib/server/sdk-helpers";
import { readSpecIndex, writeSpecIndex, readPrinciples } from "@/lib/server/spec";
import { getSpecJob, setSpecJob, updateSpecJob, clearSpecJob } from "@/lib/server/spec-jobs";
import { assembleContext } from "@/lib/server/knowledge/context";
import { SPEC_GENERATE_CONTEXT } from "@/lib/server/knowledge/contracts";
import { preflightCheck } from "@/lib/server/knowledge/preflight";
import { buildSpecGenerationPrompt } from "@/lib/server/prompts/spec";

/**
 * POST: Start spec generation as a background job.
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
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }
    if (!app.directory) {
      return NextResponse.json({ detail: "App has no directory" }, { status: 400 });
    }

    // Don't start if already running (auto-clear stale jobs after 10 minutes)
    const existing = getSpecJob(numericAppId);
    if (existing && existing.status === "running") {
      const ageMs = Date.now() - existing.started_at;
      if (ageMs < 10 * 60 * 1000) {
        return NextResponse.json({ detail: "A spec job is already running" }, { status: 409 });
      }
      // Stale job — clear it and continue
      clearSpecJob(numericAppId);
    }

    // Preflight check
    const preflight = await preflightCheck({
      appId: numericAppId,
      directory: app.directory,
      workflow: "spec_generate",
    });
    if (!preflight.ok) {
      return NextResponse.json({ detail: preflight.blockers.join("; ") }, { status: 400 });
    }

    const directory = app.directory;
    const appName = app.name;

    // Register the job
    setSpecJob(numericAppId, {
      type: "generate",
      status: "running",
      progress: "Starting...",
      error: null,
      result: null,
      started_at: Date.now(),
    });

    // Fire and forget
    runGenerateJob(numericAppId, directory, appName).catch(() => {});

    return NextResponse.json({ started: true, type: "generate" });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

async function runGenerateJob(appId: number, directory: string, appName: string): Promise<void> {
  try {
    const specPath = `${directory}/.archie/spec`;

    let prompt = buildSpecGenerationPrompt({ appName, directory, specPath });

    const principles = readPrinciples(directory);
    if (principles) {
      prompt += `\n\nTEAM PRINCIPLES (follow these when writing spec files):\n${principles}`;
    }

    // Inject existing knowledge to give Claude a head start
    try {
      const ctx = await assembleContext({
        appId,
        directory,
        needs: SPEC_GENERATE_CONTEXT,
      });
      if (ctx.formatted) {
        prompt += `\n\nEXISTING APP KNOWLEDGE (use as a starting point — verify and expand):\n${ctx.formatted}`;
      }
    } catch {}

    updateSpecJob(appId, { progress: "Exploring codebase..." });

    const toolStream = runToolEnabledStream(prompt, {
      category: "background",
      cwd: directory,
    });

    for await (const event of toolStream) {
      if (event.type === "tool_use") {
        const label = event.tool || "Tool";
        const desc = event.detail || "";
        updateSpecJob(appId, { progress: `${label}: ${desc}`.slice(0, 120) });
      } else if (event.type === "text") {
        updateSpecJob(appId, { progress: event.detail.slice(0, 100) });
      }
    }

    // Claude wrote the files directly — read back the index to get entries
    updateSpecJob(appId, { progress: "Reading generated spec files..." });

    const index = readSpecIndex(directory);
    if (index && index.entries.length > 0) {
      updateSpecJob(appId, {
        status: "completed",
        progress: `Generated ${index.entries.length} spec files`,
        result: { entries: index.entries },
      });
    } else {
      // Fallback: scan the spec directory for .md files Claude wrote
      const entries = scanSpecEntries(directory);
      if (entries.length > 0) {
        writeSpecIndex(directory, appName, entries);
        updateSpecJob(appId, {
          status: "completed",
          progress: `Generated ${entries.length} spec files`,
          result: { entries },
        });
      } else {
        updateSpecJob(appId, { status: "failed", error: "No spec files were written" });
      }
    }
  } catch (e: any) {
    updateSpecJob(appId, { status: "failed", error: e.message || String(e) });
  }
}

/**
 * Fallback: scan .archie/spec/ for .md files if Claude didn't write _index.md.
 * Extracts summaries from the > blockquote in each file.
 */
function scanSpecEntries(directory: string): { path: string; summary: string }[] {
  const specRoot = path.join(directory, ".archie", "spec");
  if (!fs.existsSync(specRoot)) return [];

  const entries: { path: string; summary: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith(".md") && entry.name !== "_index.md" && entry.name !== "PRINCIPLES.md") {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(specRoot, fullPath);
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const summaryMatch = content.match(/^>\s*(.+)$/m);
          const summary = summaryMatch ? summaryMatch[1].trim() : relPath;
          entries.push({ path: relPath, summary });
        } catch {
          entries.push({ path: relPath, summary: relPath });
        }
      }
    }
  };
  walk(specRoot);
  return entries;
}
