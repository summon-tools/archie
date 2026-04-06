"use client";

import { useState, useRef, useCallback } from "react";
import { GitDiff, SpinnerGap } from "@phosphor-icons/react";
import { getCodeWalkthroughPlan } from "@/lib/api";
import { codeWalkthroughDefinition } from "./definition";
import type { Tool, ToolContext, ToolState } from "../types";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

function useCodeWalkthroughTool(ctx: ToolContext): ToolState {
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const cancel = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setBusy(false);
    setProgress(null);
    // Restore user tab control
    ctx.setForceTab?.(null);
    ctx.setDiffHighlight?.(null);
  }, [ctx]);

  const execute = useCallback(async (goal: string) => {
    cancel();
    setBusy(true);
    setProgress("Generating walkthrough plan...");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // Switch to diff tab
      ctx.setForceTab?.("diff");

      const { steps } = await getCodeWalkthroughPlan(ctx.appId, ctx.itemId, goal);
      if (abort.signal.aborted) return;

      for (let i = 0; i < steps.length; i++) {
        if (abort.signal.aborted) break;
        const step = steps[i];

        setProgress(`Step ${i + 1}/${steps.length}: ${step.file}`);

        // Highlight the file in the diff panel
        ctx.setDiffHighlight?.(step.file);

        // Small delay for the scroll animation
        await sleep(600, abort.signal);

        // Save narration to chat
        await ctx.saveMessage(step.narration, "assistant", "code-walkthrough");
        await ctx.reloadMessages();

        // Play TTS audio if available
        if (step.audioData) {
          const audio = new Audio(step.audioData);
          const playPromise = audio.play().catch(() => {});
          await Promise.race([
            sleep((step.audioDurationMs || 3000) + 500, abort.signal),
            new Promise<void>(r => {
              abort.signal.addEventListener("abort", () => { audio.pause(); r(); }, { once: true });
            }),
          ]);
          await playPromise;
        } else {
          // No audio — pause briefly so the user can read
          await sleep(2000, abort.signal);
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") console.error("Code walkthrough failed:", e);
    } finally {
      setBusy(false);
      setProgress(null);
      ctx.setForceTab?.(null);
      ctx.setDiffHighlight?.(null);
    }
  }, [ctx, cancel]);

  return { execute, cancel, busy, progress };
}

// ---------- Components ----------

function CodeWalkthroughProgress({ progress }: { progress: string | null }) {
  return (
    <div className="flex items-start gap-2.5 animate-fadeIn">
      <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-1">
        <GitDiff size={14} weight="bold" className="text-blue-400" />
      </div>
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl rounded-tl-md px-4 py-3">
        <div className="flex items-center gap-2">
          <SpinnerGap size={14} className="animate-spin text-blue-400" />
          <span className="text-sm text-blue-400">{progress || "Explaining code..."}</span>
        </div>
      </div>
    </div>
  );
}

function CodeWalkthroughResult({ content }: { content: string; appId: number; itemId: number }) {
  return (
    <div className="flex items-start gap-2.5 animate-fadeIn">
      <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-1">
        <GitDiff size={14} weight="bold" className="text-blue-400" />
      </div>
      <div className="max-w-[80%] bg-blue-500/10 border border-blue-500/20 rounded-2xl rounded-tl-md px-4 py-3">
        <p className="text-sm text-blue-300 leading-relaxed">{content}</p>
      </div>
    </div>
  );
}

// ---------- Export ----------

export const codeWalkthrough: Tool = {
  ...codeWalkthroughDefinition,
  icon: GitDiff,
  useTool: useCodeWalkthroughTool,
  ProgressCard: CodeWalkthroughProgress,
  ResultCard: CodeWalkthroughResult,
};
