import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import {
  readSpecFile,
  writeSpecFile,
  deleteSpecFile,
  readSpecIndex,
  writeSpecIndex,
  extractSummary,
  setFrontmatterDate,
} from "@/lib/server/spec";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import { addEphemeralJob, removeEphemeralJob } from "@/lib/server/ephemeral-jobs";
import { buildSpecTaskProposalPrompt } from "@/lib/server/prompts/spec";
import { routeLogger } from "@/lib/server/logger";

const log = routeLogger("spec/[...path]");

/**
 * GET: Read a specific spec file.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; path: string[] }> }
) {
  try {
    await getAuthUser(request);
    const { appId, path: pathParts } = await params;
    const filePath = pathParts.join("/");

    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    const content = readSpecFile(app.directory, filePath);
    if (content === null) {
      return NextResponse.json({ detail: "Spec file not found" }, { status: 404 });
    }

    return NextResponse.json({ path: filePath, content });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * PUT: Write/update a spec file. Updates the index summary automatically.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; path: string[] }> }
) {
  try {
    await getAuthUser(request);
    const { appId, path: pathParts } = await params;
    const filePath = pathParts.join("/");
    const body = await request.json();
    const { content } = body;

    if (typeof content !== "string") {
      return NextResponse.json({ detail: "content is required" }, { status: 400 });
    }

    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    // Read old content before overwriting (for task proposal diffing)
    const oldContent = readSpecFile(app.directory, filePath);

    const contentWithDate = setFrontmatterDate(content);
    writeSpecFile(app.directory, filePath, contentWithDate);

    // Update index entry
    const index = readSpecIndex(app.directory);
    const summary = extractSummary(content);
    const appName = index?.appName || app.name;
    const entries = index?.entries || [];
    const existing = entries.find((e) => e.path === filePath);
    if (existing) {
      if (summary) existing.summary = summary;
    } else {
      entries.push({ path: filePath, summary: summary || filePath });
    }
    writeSpecIndex(app.directory, appName, entries);

    // Fire-and-forget: propose task if spec changed meaningfully
    log.debug({ filePath, oldLen: oldContent?.length ?? null, newLen: content.length }, "spec file updated");
    if (oldContent && oldContent !== content && filePath !== "PRINCIPLES.md") {
      log.debug({ filePath }, "triggering task proposal evaluation");
      proposeTaskFromSpecChange(app.directory, app.name, filePath, oldContent, content, Number(appId)).catch((e) => {
        log.error({ err: e, filePath }, "proposeTaskFromSpecChange failed");
      });
    } else {
      log.debug({ filePath, hasOld: !!oldContent, changed: oldContent !== content }, "spec change skipped");
    }

    return NextResponse.json({ path: filePath, summary });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * DELETE: Delete a spec file and remove from index.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; path: string[] }> }
) {
  try {
    await getAuthUser(request);
    const { appId, path: pathParts } = await params;
    const filePath = pathParts.join("/");

    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    const deleted = deleteSpecFile(app.directory, filePath);
    if (!deleted) {
      return NextResponse.json({ detail: "Spec file not found" }, { status: 404 });
    }

    // Remove from index
    const index = readSpecIndex(app.directory);
    if (index) {
      const entries = index.entries.filter((e) => e.path !== filePath);
      writeSpecIndex(app.directory, index.appName, entries);
    }

    return NextResponse.json({ deleted: filePath });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * Fire-and-forget: ask Claude whether a spec change warrants a code task.
 */
async function proposeTaskFromSpecChange(
  directory: string,
  appName: string,
  specPath: string,
  oldContent: string,
  newContent: string,
  appId?: number
): Promise<void> {
  const jobId = `task-proposal-${appId}-${Date.now()}`;
  if (appId) {
    addEphemeralJob({
      id: jobId,
      app_id: appId,
      type: "task_proposal",
      label: "Evaluating spec change…",
      started_at: Date.now(),
    });
  }
  try {
    log.debug({ specPath }, "evaluating spec change");

    // Build a simple line-based diff instead of truncated full content
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const added: string[] = [];
    const removed: string[] = [];
    const newSet = new Set(newLines);
    const oldSet = new Set(oldLines);
    for (const line of newLines) {
      if (!oldSet.has(line) && line.trim()) added.push(`+ ${line}`);
    }
    for (const line of oldLines) {
      if (!newSet.has(line) && line.trim()) removed.push(`- ${line}`);
    }
    const diff = [...removed, ...added].slice(0, 80).join("\n");

    const prompt = buildSpecTaskProposalPrompt({
      appName,
      specPath,
      diff,
      newContent,
    });

    const result = await runEphemeralQuery(prompt, { category: "quick" });
    log.debug({ specPath }, "received task proposal response");

    const cleaned = result.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    let parsed: { needs_task: boolean; title?: string; description?: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        log.warn({ specPath }, "task proposal response not valid JSON");
        return;
      }
      parsed = JSON.parse(match[0]);
    }

    if (!parsed.needs_task || !parsed.title) {
      log.debug({ specPath, needsTask: parsed.needs_task }, "no task needed");
      return;
    }

    log.debug({ specPath, title: parsed.title, needsTask: true }, "spec change flagged as needing a task");
  } catch (e) {
    log.error({ err: e, specPath }, "error evaluating spec change");
  } finally {
    removeEphemeralJob(jobId);
  }
}
