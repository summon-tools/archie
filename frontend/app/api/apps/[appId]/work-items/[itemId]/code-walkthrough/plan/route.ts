import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import type { AppRow } from "@/lib/server/types";
import * as dal from "@/lib/server/dal";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import { assembleContext } from "@/lib/server/knowledge/context";
import { CODE_WALKTHROUGH_CONTEXT } from "@/lib/server/knowledge/contracts";
import { buildCodeWalkthroughPlanPrompt } from "@/lib/server/prompts/demo";
import { routeLogger } from "@/lib/server/logger";

const log = routeLogger("code-walkthrough/plan");
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  try {
    const { appId, itemId } = await params;
    const db = getDb();

    const app = db.prepare("SELECT * FROM apps WHERE id = ?").get(Number(appId)) as AppRow | undefined;
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const workItem = dal.getWorkItem(Number(itemId));
    if (!workItem) {
      return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
    }

    const env = dal.getWorkItemEnv(workItem.id);
    const worktreeDir = env?.worktree_dir || app.directory;

    const body = await request.json().catch(() => ({}));
    const goal = body.goal || "Explain the code changes in this task";
    const voice = (app as any).demo_tts_voice || "en-US-AndrewNeural";

    // Get the full diff
    let fullDiff = "";
    try {
      fullDiff = execSync("git diff main --no-color", {
        cwd: worktreeDir,
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
    } catch {
      // Try HEAD~1 as fallback
      try {
        fullDiff = execSync("git diff HEAD~1 --no-color", {
          cwd: worktreeDir,
          encoding: "utf-8",
          timeout: 10000,
        }).trim();
      } catch {}
    }

    if (!fullDiff) {
      return NextResponse.json({ detail: "No diff found" }, { status: 400 });
    }

    // Assemble context
    const ctx = await assembleContext({
      appId: Number(appId),
      directory: worktreeDir,
      workItemId: workItem.id,
      needs: CODE_WALKTHROUGH_CONTEXT,
    });

    const prompt = buildCodeWalkthroughPlanPrompt({
      goal,
      appName: app.name,
      taskTitle: workItem.title || undefined,
      contextFormatted: ctx.formatted || "",
      fullDiff,
    });

    const result = await runEphemeralQuery(prompt, {
      category: "quick",
    });

    // Parse the JSON
    let steps: { file: string; narration: string }[];
    try {
      const cleaned = result.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      steps = JSON.parse(cleaned);
    } catch {
      const match = result.match(/\[[\s\S]*\]/);
      if (!match) {
        return NextResponse.json({ detail: "Failed to parse walkthrough plan" }, { status: 500 });
      }
      steps = JSON.parse(match[0]);
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ detail: "No walkthrough steps generated" }, { status: 500 });
    }

    // Generate TTS for each step
    const stepsWithAudio: { file: string; narration: string; audioData?: string; audioDurationMs?: number }[] = [];

    for (const step of steps) {
      const enriched: typeof stepsWithAudio[number] = { file: step.file, narration: step.narration };

      if (step.narration) {
        const tmpDir = path.join("/tmp", `cwt-${appId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        try {
          const clipPath = path.join(tmpDir, "narration.mp3");
          const { EdgeTTS } = await import("node-edge-tts");
          const tts = new EdgeTTS({ voice, lang: "en-US", outputFormat: "audio-24khz-48kbitrate-mono-mp3" });
          await tts.ttsPromise(step.narration, clipPath);
          const { stdout } = await execFileAsync("ffprobe", [
            "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", clipPath,
          ]);
          const durationMs = Math.ceil(parseFloat(stdout.trim()) * 1000);
          const audioBuffer = fs.readFileSync(clipPath);
          enriched.audioData = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
          enriched.audioDurationMs = durationMs;
        } catch {
          // TTS failed — step still works without audio
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
        }
      }

      stepsWithAudio.push(enriched);
    }

    return NextResponse.json({ steps: stepsWithAudio });
  } catch (e: any) {
    log.error({ err: e }, "code walkthrough plan failed");
    return NextResponse.json(
      { detail: e.message || "Failed to generate code walkthrough" },
      { status: 500 }
    );
  }
}
