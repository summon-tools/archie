import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { routeLogger } from "@/lib/server/logger";

const execFileAsync = promisify(execFile);
const log = routeLogger("demo/walkthrough/step");

interface StepAction {
  type: "goto" | "click" | "fill" | "wait" | "evaluate" | "narrate";
  path?: string;
  selector?: string;
  value?: string;
  ms?: number;
  code?: string;
  text?: string;
  audioData?: string;
  audioDurationMs?: number;
}

interface HistoryEntry {
  narration: string;
  path: string;
}

/**
 * POST: Observation loop -- one step at a time.
 *
 * Body: {
 *   goal: string,
 *   pageSnapshot: string,
 *   currentPath: string,
 *   viewportWidth: number,
 *   viewportHeight: number,
 *   history: HistoryEntry[],
 *   seedSummary?: string,
 * }
 *
 * Response: {
 *   actions: StepAction[],
 *   narrationText: string,
 *   done: boolean,
 * }
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

    const {
      goal,
      pageSnapshot,
      currentPath = "/",
      viewportWidth = 1280,
      viewportHeight = 720,
      history = [] as HistoryEntry[],
      seedSummary = "",
    } = body;

    if (!goal || !pageSnapshot) {
      return NextResponse.json({ detail: "goal and pageSnapshot are required" }, { status: 400 });
    }

    // Build the prompt
    const historyText = history.length > 0
      ? history.map((h: HistoryEntry, i: number) => `${i + 1}. "${h.narration}" (on ${h.path})`).join("\n")
      : "(This is the first step)";

    const prompt = `You are giving a live guided walkthrough of a web app. You execute ONE step at a time.

GOAL: ${goal}
APP: ${wi.title}
${wi.summary ? `CONTEXT: ${wi.summary}` : ""}
${seedSummary ? `AVAILABLE DATA/CREDENTIALS:\n${seedSummary}` : ""}

COMPLETED STEPS:
${historyText}

CURRENT PAGE: ${currentPath}
VIEWPORT: ${viewportWidth}x${viewportHeight}px

PAGE SNAPSHOT (live DOM):
${pageSnapshot}

Return the NEXT step of the walkthrough. Output:
1. A // NARRATE: comment (one natural sentence describing what the viewer is seeing or what you're about to do)
2. 1-4 Playwright actions to execute this step
3. If the walkthrough is complete, add // DONE as the last line

RULES:
- Use \`page\` variable (Playwright Page)
- ALLOWED: click, fill, goto, waitForSelector, waitForTimeout, evaluate
- Use ONLY selectors from the PAGE SNAPSHOT — never guess or invent selectors
- Selector priority:
  1. \`page.click('a[href="/path"]')\` for links (exact href from snapshot)
  2. \`page.click('text=Exact Text')\` for buttons (exact text from snapshot)
  3. \`page.fill('input[name="field"]', 'value')\` for inputs
- NEVER use :has-text(), :has(), >>, or locator-only pseudo-selectors
- For scrolling: \`await page.evaluate(() => document.querySelector('SELECTOR').scrollIntoView({ behavior: "smooth", block: "center" }))\`
- NEVER use pixel-based scrollBy/scrollTo
- Add \`await page.waitForTimeout(1500)\` after actions that change the page
- If the page is empty and you need data to demo the goal, create it by filling forms
- If you need to log in and credentials are available, log in first
- Keep it focused -- one logical step per response
- If you've shown everything relevant to the goal, output // DONE

Example response:
// NARRATE: Let's create a new blog post using the form
await page.click('a[href="/posts/new"]');
await page.waitForTimeout(1500);
await page.fill('input[name="title"]', 'My First Post');
await page.fill('textarea[name="body"]', 'This is a sample post to demonstrate the blog feature.');

Output ONLY the script lines, no markdown fences or explanation.`;

    const result = await runEphemeralQuery(prompt, {
      category: "quick",
    });

    const script = result
      .replace(/^```(?:javascript|typescript|js|ts)?\n?/gm, "")
      .replace(/```\s*$/gm, "")
      .trim();

    // Check if done
    const done = /\/\/\s*DONE\s*$/.test(script);

    // Parse the script into actions
    const actions = parseStepActions(script, previewUrl);

    // Extract narration text
    const narrationAction = actions.find(a => a.type === "narrate");
    const narrationText = narrationAction?.text || "";

    // Generate TTS for the narration
    if (narrationText) {
      const tmpDir = path.join("/tmp", `wt-step-${itemId}-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      try {
        const clipPath = path.join(tmpDir, "narration.mp3");
        const { EdgeTTS } = await import("node-edge-tts");
        const tts = new EdgeTTS({
          voice,
          lang: "en-US",
          outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        });
        await tts.ttsPromise(narrationText, clipPath);
        const { stdout } = await execFileAsync("ffprobe", [
          "-v", "quiet", "-show_entries", "format=duration",
          "-of", "csv=p=0", clipPath,
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

    // Remove // DONE from raw script before returning
    const rawScript = script.replace(/\/\/\s*DONE\s*$/m, "").trim();

    return NextResponse.json({
      actions,
      narrationText,
      rawScript,
      done,
    });
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

/**
 * Parse a step's Playwright snippet into structured actions.
 */
function parseStepActions(script: string, previewUrl: string): StepAction[] {
  const actions: StepAction[] = [];
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

    // // DONE
    if (/^\/\/\s*DONE/.test(trimmed)) continue;

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

    // await page.waitForSelector('...')
    const waitSelMatch = trimmed.match(/await\s+page\.waitForSelector\(\s*(['"`])(.*?)\1/);
    if (waitSelMatch) {
      actions.push({ type: "wait", ms: 1000 });
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
