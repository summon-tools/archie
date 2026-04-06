import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import {
  readDriftResults,
  clearDriftResults,
  removeDriftResult,
  readSpecFile,
  readSpecIndex,
  writeSpecFile,
  writeSpecIndex,
  extractSummary,
  deleteSpecFile,
} from "@/lib/server/spec";
import { runToolEnabledStream } from "@/lib/server/sdk-helpers";
import { getSpecJob, setSpecJob, updateSpecJob, clearSpecJob } from "@/lib/server/spec-jobs";
import { buildSpecDriftRewritePrompt } from "@/lib/server/prompts/spec";

/**
 * GET: Return persisted drift results.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    const results = readDriftResults(app.directory);
    return NextResponse.json({ results });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * POST: Resolve drift for one or all files.
 * Body:
 *   { action: "update_spec", path: "auth/login.md" }     — regenerate this spec file from code
 *   { action: "create_task", path: "auth/login.md" }     — create task to fix code to match spec
 *   { action: "remove_spec", path: "admin/old.md" }      — delete the spec file (missing from code)
 *   { action: "dismiss", path: "auth/login.md" }         — dismiss single drift result
 *   { action: "update_all" }                             — regenerate all drifted specs
 *   { action: "dismiss_all" }                            — clear all drift results
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { appId } = await params;
    const body = await request.json();
    const { action, path: specPath } = body;

    const numericAppId = Number(appId);
    const app = dal.getApp(numericAppId);
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    if (action === "dismiss_all") {
      clearDriftResults(app.directory);
      return NextResponse.json({ message: "All drift results dismissed" });
    }

    if (action === "update_all") {
      const existing = getSpecJob(numericAppId);
      if (existing && existing.status === "running") {
        const ageMs = Date.now() - existing.started_at;
        if (ageMs < 10 * 60 * 1000) {
          return NextResponse.json({ detail: "A spec job is already running" }, { status: 409 });
        }
        clearSpecJob(numericAppId);
      }

      const results = readDriftResults(app.directory);
      const drifted = results.filter((r) => r.status === "drifted" || r.status === "missing");
      if (drifted.length === 0) {
        return NextResponse.json({ message: "Nothing to update" });
      }

      setSpecJob(numericAppId, {
        type: "update_specs",
        status: "running",
        progress: `Updating 0/${drifted.length} specs...`,
        error: null,
        result: null,
        started_at: Date.now(),
      });

      runUpdateAllJob(numericAppId, app.directory, app.name, drifted).catch(() => {});
      return NextResponse.json({ started: true, type: "update_specs", count: drifted.length });
    }

    if (!specPath) {
      return NextResponse.json({ detail: "path is required" }, { status: 400 });
    }

    if (action === "dismiss") {
      removeDriftResult(app.directory, specPath);
      return NextResponse.json({ message: "Dismissed" });
    }

    if (action === "update_spec") {
      const existing = getSpecJob(numericAppId);
      if (existing && existing.status === "running") {
        const ageMs = Date.now() - existing.started_at;
        if (ageMs < 10 * 60 * 1000) {
          return NextResponse.json({ detail: "A spec job is already running" }, { status: 409 });
        }
        clearSpecJob(numericAppId);
      }

      const detail = body.detail || "";
      setSpecJob(numericAppId, {
        type: "update_specs",
        status: "running",
        progress: `Updating ${specPath}...`,
        error: null,
        result: null,
        started_at: Date.now(),
      });

      runUpdateSingleJob(numericAppId, app.directory, app.name, specPath, detail).catch(() => {});
      return NextResponse.json({ started: true, type: "update_specs" });
    }

    if (action === "create_task") {
      const results = readDriftResults(app.directory);
      const drift = results.find((r) => r.path === specPath);
      const detail = drift?.detail || body.detail || "";

      const title = drift?.status === "missing"
        ? `Implement ${specPath.replace(/\.md$/, "")} (missing from codebase)`
        : `Fix drift in ${specPath.replace(/\.md$/, "")}`;
      const description = `The spec file \`${specPath}\` doesn't match the codebase.\n\n**Drift detail:** ${detail}`;

      const conversation = dal.createConversation({ app_id: numericAppId, kind: "task", title, created_by: user.id });
      dal.createWorkItem({ app_id: numericAppId, primary_conversation_id: conversation.id, title, summary: description, created_by: user.id });

      removeDriftResult(app.directory, specPath);
      return NextResponse.json({ message: "Task created" });
    }

    if (action === "remove_spec") {
      deleteSpecFile(app.directory, specPath);
      const index = readSpecIndex(app.directory);
      if (index) {
        const entries = index.entries.filter((e) => e.path !== specPath);
        writeSpecIndex(app.directory, index.appName, entries);
      }
      removeDriftResult(app.directory, specPath);
      return NextResponse.json({ message: "Spec file removed" });
    }

    return NextResponse.json({ detail: "Invalid action" }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * Regenerate a single spec file by asking Claude to rewrite it based on the current codebase.
 */
async function regenerateSpecFile(
  directory: string,
  appName: string,
  specPath: string,
  driftDetail: string
): Promise<void> {
  const oldContent = readSpecFile(directory, specPath) || "";

  const prompt = buildSpecDriftRewritePrompt({
    appName,
    directory,
    specPath,
    oldContent,
    driftDetail,
  });

  let resultText = "";
  const stream = runToolEnabledStream(prompt, {
    category: "background",
    cwd: directory,
  });
  for await (const event of stream) {
    if (event.type === "result" && event.resultText) {
      resultText = event.resultText;
    }
  }

  // Strip code fences if present
  let content = resultText.replace(/^```(?:markdown|md)?\n?/m, "").replace(/\n?```$/m, "").trim();

  // Strip any trailing commentary after the spec content
  // The spec ends after the last ## section content — cut at common LLM commentary patterns
  const commentaryPatterns = [
    /\n---\n\nThe main changes/i,
    /\n---\n\nHere is/i,
    /\n---\n\nChanges made/i,
    /\n---\n\nKey changes/i,
    /\n\nThe main changes/i,
    /\n\nHere is the rewritten/i,
    /\n\nChanges from the/i,
    /\n\nKey changes/i,
    /\n\nSummary of changes/i,
    /\n\nNote:/i,
  ];
  for (const pattern of commentaryPatterns) {
    const match = content.match(pattern);
    if (match && match.index !== undefined) {
      content = content.slice(0, match.index).trim();
    }
  }
  if (!content) return;

  writeSpecFile(directory, specPath, content);

  // Update index
  const index = readSpecIndex(directory);
  if (index) {
    const summary = extractSummary(content);
    const existing = index.entries.find((e) => e.path === specPath);
    if (existing && summary) {
      existing.summary = summary;
    }
    writeSpecIndex(directory, index.appName, index.entries);
  }
}

async function runUpdateAllJob(
  appId: number,
  directory: string,
  appName: string,
  drifted: { path: string; status: string; detail: string }[]
): Promise<void> {
  let updated = 0;
  try {
    for (const r of drifted) {
      updateSpecJob(appId, { progress: `Updating ${r.path} (${updated + 1}/${drifted.length})...` });
      try {
        await regenerateSpecFile(directory, appName, r.path, r.detail);
        removeDriftResult(directory, r.path);
        updated++;
      } catch {
        // skip failed file, continue with rest
      }
    }
    updateSpecJob(appId, {
      status: "completed",
      progress: `Updated ${updated}/${drifted.length} spec files`,
      result: { updated },
    });
  } catch (e: any) {
    updateSpecJob(appId, { status: "failed", error: e.message || String(e) });
  }
}

async function runUpdateSingleJob(
  appId: number,
  directory: string,
  appName: string,
  specPath: string,
  detail: string
): Promise<void> {
  try {
    await regenerateSpecFile(directory, appName, specPath, detail);
    removeDriftResult(directory, specPath);
    updateSpecJob(appId, {
      status: "completed",
      progress: `Updated ${specPath}`,
      result: { updated: 1 },
    });
  } catch (e: any) {
    updateSpecJob(appId, { status: "failed", error: e.message || String(e) });
  }
}
