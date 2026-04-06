import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import { buildLiveWalkthroughPrompt } from "@/lib/server/prompts/demo";
import { routeLogger } from "@/lib/server/logger";

const log = routeLogger("demo/walkthrough");
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface WalkthroughAction {
  type: "goto" | "click" | "fill" | "wait" | "narrate" | "evaluate";
  path?: string;
  selector?: string;
  value?: string;
  ms?: number;
  text?: string;
  audioData?: string;
  audioDurationMs?: number;
  code?: string;
}

/**
 * POST: Generate or replay a walkthrough.
 *
 * Body options:
 * - { mode: "replay" }  -> parse existing demo_script
 * - { mode: "live", pageSnapshot, currentPath, viewportWidth, viewportHeight }
 *     -> generate a fresh script from the live iframe snapshot
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, itemId } = await params;
    const body = await request.json();

    const wi = dal.getWorkItem(Number(itemId));
    if (!wi || wi.app_id !== Number(appId)) {
      return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
    }

    const app = dal.getApp(Number(appId));
    const env = dal.getWorkItemEnv(wi.id);

    const voice = (app as any)?.demo_tts_voice || "en-US-AndrewNeural";
    const previewUrl = env?.preview_port ? `http://localhost:${env.preview_port}` : "";

    let script: string;

    // Get walkthrough artifact
    const walkthroughArt = dal.getArtifactByKind(wi.id, "walkthrough_script");
    const scriptArt = dal.getArtifactByKind(wi.id, "demo_script");

    if (body.mode === "replay_walkthrough") {
      if (!walkthroughArt?.inline_text) {
        return NextResponse.json({ detail: "No walkthrough script saved" }, { status: 400 });
      }
      script = walkthroughArt.inline_text;
    } else if (body.mode === "live") {
      if (!body.pageSnapshot) {
        return NextResponse.json({ detail: "pageSnapshot is required for live mode" }, { status: 400 });
      }
      script = await generateLiveScript({
        taskTitle: wi.title,
        taskDescription: wi.summary || "",
        pageSnapshot: body.pageSnapshot,
        currentPath: body.currentPath || "/",
        viewportWidth: body.viewportWidth || 1280,
        viewportHeight: body.viewportHeight || 720,
        previewUrl,
      });

      // Save the generated script as artifact
      dal.deleteArtifactsByKind(wi.id, "walkthrough_script");
      dal.createArtifact({
        app_id: Number(appId),
        work_item_id: wi.id,
        kind: "walkthrough_script",
        storage_type: "inline",
        inline_text: script,
      });
    } else {
      if (!scriptArt?.inline_text) {
        return NextResponse.json({ detail: "No demo script available" }, { status: 400 });
      }
      script = scriptArt.inline_text;
    }

    // Parse script into actions
    const actions = parseScriptToActions(script, previewUrl);

    // Generate TTS for narration actions
    const narrationSegments = actions
      .filter(a => a.type === "narrate" && a.text)
      .map(a => ({ text: a.text! }));

    if (narrationSegments.length > 0) {
      const tmpDir = path.join("/tmp", `walkthrough-${itemId}-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        const clips = await generateTTSClips(narrationSegments, tmpDir, voice);

        let clipIdx = 0;
        for (const action of actions) {
          if (action.type === "narrate" && action.text && clipIdx < clips.length) {
            const clip = clips[clipIdx];
            if (clip.clipPath) {
              try {
                const audioBuffer = fs.readFileSync(clip.clipPath);
                action.audioData = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
                action.audioDurationMs = clip.durationMs;
              } catch {}
            }
            clipIdx++;
          }
        }
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
      }
    }

    return NextResponse.json({ actions });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    log.error({ err: e }, "walkthrough failed");
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "Failed to prepare walkthrough" },
      { status: 500 }
    );
  }
}

/**
 * PUT: Save a walkthrough script (e.g. accumulated from observation loop).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, itemId } = await params;
    const { script } = await request.json();

    if (!script) {
      return NextResponse.json({ detail: "script is required" }, { status: 400 });
    }

    const wi = dal.getWorkItem(Number(itemId));
    if (!wi || wi.app_id !== Number(appId)) {
      return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
    }

    dal.deleteArtifactsByKind(wi.id, "walkthrough_script");
    dal.createArtifact({
      app_id: Number(appId),
      work_item_id: wi.id,
      kind: "walkthrough_script",
      storage_type: "inline",
      inline_text: script,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

/**
 * Generate a fresh Playwright walkthrough script from a live page snapshot.
 */
async function generateLiveScript(opts: {
  taskTitle: string;
  taskDescription: string;
  pageSnapshot: string;
  currentPath: string;
  viewportWidth: number;
  viewportHeight: number;
  previewUrl: string;
}): Promise<string> {
  const { taskTitle, taskDescription, pageSnapshot, currentPath, viewportWidth, viewportHeight, previewUrl } = opts;

  const prompt = buildLiveWalkthroughPrompt({
    taskTitle,
    taskDescription,
    previewUrl,
    currentPath,
    viewportWidth,
    viewportHeight,
    pageSnapshot,
  });

  const result = await runEphemeralQuery(prompt, {
    category: "demo",
  });

  return result
    .replace(/^```(?:javascript|typescript|js|ts)?\n?/gm, "")
    .replace(/```\s*$/gm, "")
    .trim();
}

/**
 * Parse a Playwright script into structured walkthrough actions.
 */
function parseScriptToActions(script: string, previewUrl: string): WalkthroughAction[] {
  const actions: WalkthroughAction[] = [];
  const lines = script.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // // NARRATE: ...
    const narrateMatch = trimmed.match(/^\/\/\s*NARRATE:\s*(.+)$/);
    if (narrateMatch) {
      actions.push({ type: "narrate", text: narrateMatch[1].trim() });
      continue;
    }

    // Skip other comments
    if (trimmed.startsWith("//")) continue;

    // await page.goto('...')
    const gotoMatch = trimmed.match(/await\s+page\.goto\(\s*(['"`])(.+?)\1/);
    if (gotoMatch) {
      let navUrl = gotoMatch[2];
      if (navUrl.startsWith(previewUrl)) {
        navUrl = navUrl.slice(previewUrl.length) || "/";
      }
      if (navUrl.startsWith("http")) {
        try { navUrl = new URL(navUrl).pathname; } catch {}
      }
      actions.push({ type: "goto", path: navUrl });
      continue;
    }

    // await page.click('...')
    const clickMatch = trimmed.match(/await\s+page\.click\(\s*(['"`])(.*?)\1\s*\)/);
    if (clickMatch) {
      actions.push({ type: "click", selector: clickMatch[2] });
      continue;
    }

    // await page.fill('selector', 'value')
    const fillMatch = trimmed.match(/await\s+page\.fill\(\s*(['"`])(.*?)\1\s*,\s*(['"`])([\s\S]*?)\3/);
    if (fillMatch) {
      actions.push({ type: "fill", selector: fillMatch[2], value: fillMatch[4] });
      continue;
    }

    // await page.waitForTimeout(ms)
    const waitMatch = trimmed.match(/await\s+page\.waitForTimeout\(\s*(\d+)\s*\)/);
    if (waitMatch) {
      actions.push({ type: "wait", ms: parseInt(waitMatch[1]) });
      continue;
    }

    // await page.evaluate(() => ...)
    const evalMatch = trimmed.match(/await\s+page\.evaluate\(\s*\(\s*\)\s*=>\s*\{?\s*([\s\S]+?)\s*\}?\s*\)\s*;?\s*$/);
    if (evalMatch) {
      actions.push({ type: "evaluate", code: evalMatch[1] });
      continue;
    }
    const evalMatch2 = trimmed.match(/await\s+page\.evaluate\(\s*\(\s*\)\s*=>\s*(.+?)\s*\)\s*;?\s*$/);
    if (evalMatch2) {
      actions.push({ type: "evaluate", code: evalMatch2[1] });
      continue;
    }
  }

  return actions;
}

/**
 * Generate TTS clips using edge-tts.
 */
async function generateTTSClips(
  segments: { text: string }[],
  tempDir: string,
  voice: string
): Promise<{ clipPath: string | null; durationMs: number }[]> {
  const { EdgeTTS } = await import("node-edge-tts");
  const clips: { clipPath: string | null; durationMs: number }[] = [];

  for (let i = 0; i < segments.length; i++) {
    const clipPath = path.join(tempDir, `narration-${i}.mp3`);
    try {
      const tts = new EdgeTTS({
        voice,
        lang: "en-US",
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      });
      await tts.ttsPromise(segments[i].text, clipPath);
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "quiet", "-show_entries", "format=duration",
        "-of", "csv=p=0", clipPath,
      ]);
      const durationMs = Math.ceil(parseFloat(stdout.trim()) * 1000);
      clips.push({ clipPath, durationMs });
    } catch {
      clips.push({ clipPath: null, durationMs: 0 });
    }
  }

  return clips;
}
