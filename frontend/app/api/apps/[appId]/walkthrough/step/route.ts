import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import type { AppRow } from "@/lib/server/types";
import { assembleContext } from "@/lib/server/knowledge/context";
import { WALKTHROUGH_CONTEXT } from "@/lib/server/knowledge/contracts";
import { buildWalkthroughStepPrompt } from "@/lib/server/prompts/demo";
import { routeLogger } from "@/lib/server/logger";

const log = routeLogger("walkthrough/step");
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * POST: App-level walkthrough step (runs on main branch, no task needed).
 *
 * Same as the task-level step API but uses the app's own port and context.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    const body = await request.json();
    const db = getDb();

    const app = db
      .prepare("SELECT * FROM apps WHERE id = ?")
      .get(Number(appId)) as AppRow | undefined;
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const voice = (app as any).demo_tts_voice || "en-US-AndrewNeural";

    const {
      goal,
      pageSnapshot,
      currentPath = "/",
      viewportWidth = 1280,
      viewportHeight = 720,
      history = [],
    } = body;

    if (!goal || !pageSnapshot) {
      return NextResponse.json({ detail: "goal and pageSnapshot are required" }, { status: 400 });
    }

    const historyText = history.length > 0
      ? history.map((h: any, i: number) => `${i + 1}. "${h.narration}" (on ${h.path})`).join("\n")
      : "(This is the first step)";

    // Inject context for walkthrough via context assembler
    let contextSection = "";
    if (app.directory) {
      try {
        const ctx = await assembleContext({
          appId: app.id,
          directory: app.directory,
          needs: WALKTHROUGH_CONTEXT,
        });
        if (ctx.formatted) {
          contextSection = `\n${ctx.formatted}\n`;
        }
      } catch {}
    }

    const prompt = buildWalkthroughStepPrompt({
      goal,
      appName: app.name,
      appDescription: app.description || undefined,
      contextSection,
      historyText,
      currentPath,
      viewportWidth,
      viewportHeight,
      pageSnapshot,
    });

    const result = await runEphemeralQuery(prompt, {
      category: "quick",
    });

    const script = result
      .replace(/^```(?:javascript|typescript|js|ts)?\n?/gm, "")
      .replace(/```\s*$/gm, "")
      .trim();

    const done = /\/\/\s*DONE\s*$/.test(script);
    const actions = parseStepActions(script);
    const narrationAction = actions.find(a => a.type === "narrate");
    const narrationText = narrationAction?.text || "";

    // Generate TTS
    if (narrationText) {
      const tmpDir = path.join("/tmp", `wt-app-${appId}-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      try {
        const clipPath = path.join(tmpDir, "narration.mp3");
        const { EdgeTTS } = await import("node-edge-tts");
        const tts = new EdgeTTS({ voice, lang: "en-US", outputFormat: "audio-24khz-48kbitrate-mono-mp3" });
        await tts.ttsPromise(narrationText, clipPath);
        const { stdout } = await execFileAsync("ffprobe", [
          "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", clipPath,
        ]);
        const durationMs = Math.ceil(parseFloat(stdout.trim()) * 1000);
        const audioBuffer = fs.readFileSync(clipPath);
        if (narrationAction) {
          narrationAction.audioData = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
          narrationAction.audioDurationMs = durationMs;
        }
      } catch (e) {
        log.warn({ err: e }, "TTS generation failed");
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      }
    }

    const rawScript = script.replace(/\/\/\s*DONE\s*$/m, "").trim();

    return NextResponse.json({ actions, narrationText, rawScript, done });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    log.error({ err: e }, "walkthrough step failed");
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "Failed to generate step" },
      { status: 500 }
    );
  }
}

/** Parse step actions — same as task-level parser */
function parseStepActions(script: string): any[] {
  const actions: any[] = [];
  const lines = script.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const narrateMatch = trimmed.match(/^\/\/\s*NARRATE:\s*(.+)$/);
    if (narrateMatch) { actions.push({ type: "narrate", text: narrateMatch[1].trim() }); continue; }
    if (/^\/\/\s*DONE/.test(trimmed)) continue;
    if (trimmed.startsWith("//")) continue;

    const gotoMatch = trimmed.match(/await\s+page\.goto\(\s*(['"`])(.+?)\1/);
    if (gotoMatch) {
      let url = gotoMatch[2];
      if (url.startsWith("http")) { try { url = new URL(url).pathname; } catch {} }
      actions.push({ type: "goto", path: url });
      continue;
    }

    const clickMatch = trimmed.match(/await\s+page\.click\(\s*(['"`])(.*?)\1\s*\)/);
    if (clickMatch) { actions.push({ type: "click", selector: clickMatch[2] }); continue; }

    const fillMatch = trimmed.match(/await\s+page\.fill\(\s*(['"`])(.*?)\1\s*,\s*(['"`])([\s\S]*?)\3/);
    if (fillMatch) { actions.push({ type: "fill", selector: fillMatch[2], value: fillMatch[4] }); continue; }

    const waitMatch = trimmed.match(/await\s+page\.waitForTimeout\(\s*(\d+)\s*\)/);
    if (waitMatch) { actions.push({ type: "wait", ms: parseInt(waitMatch[1]) }); continue; }

    const waitSelMatch = trimmed.match(/await\s+page\.waitForSelector\(\s*(['"`])(.*?)\1/);
    if (waitSelMatch) { actions.push({ type: "wait", ms: 1000 }); continue; }

    const evalMatch = trimmed.match(/await\s+page\.evaluate\(\s*\(\s*\)\s*=>\s*\{?\s*([\s\S]+?)\s*\}?\s*\)\s*;?\s*$/);
    if (evalMatch) { actions.push({ type: "evaluate", code: evalMatch[1] }); continue; }
    const evalMatch2 = trimmed.match(/await\s+page\.evaluate\(\s*\(\s*\)\s*=>\s*(.+?)\s*\)\s*;?\s*$/);
    if (evalMatch2) { actions.push({ type: "evaluate", code: evalMatch2[1] }); continue; }
  }

  return actions;
}
