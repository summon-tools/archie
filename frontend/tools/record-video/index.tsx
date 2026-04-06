"use client";

import { useState, useRef, useCallback } from "react";
import { generateDemoScript, generateDemo, getDemoVideoUrl, getDemoVideoUrlByArtifact } from "@/lib/api";
import { VideoCamera, DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import type { Tool, ToolContext, ToolState } from "../types";
import { recordVideoDefinition } from "./definition";
import { ensurePreviewRunning } from "../ensurePreview";

function useRecordVideoTool(ctx: ToolContext): ToolState {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const consumeSSE = async (
    response: Response,
    onEvent: (eventType: string, data: any) => void,
  ) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        if (!event.trim() || event.trim().startsWith(":")) continue;
        let eventType = "";
        let dataStr = "";
        for (const line of event.split("\n")) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataStr += line.slice(6);
        }
        if (!dataStr) continue;
        try {
          onEvent(eventType, JSON.parse(dataStr));
        } catch {}
      }
    }
  };

  const execute = useCallback(async (input: string) => {
    if (busy) return;
    setBusy(true);
    setProgress("Generating demo script...");

    let videoUrl: string | null = null;
    let error: string | null = null;

    try {
      // Step 0: Ensure preview is running
      const previewReady = await ensurePreviewRunning(ctx, setProgress);
      if (!previewReady) {
        await ctx.saveMessage("Could not start the preview. Please start it manually and try again.", "assistant");
        await ctx.reloadMessages();
        return;
      }

      // Switch to preview tab
      ctx.setForceTab?.("preview");

      // Step 1: Generate script
      let script: string | null = null;
      const scriptResponse = await generateDemoScript(ctx.appId, ctx.itemId);
      await consumeSSE(scriptResponse, (eventType, data) => {
        if (eventType === "progress") {
          setProgress(data.message || "Generating script...");
        } else if (eventType === "result") {
          script = data.script || null;
        } else if (eventType === "error") {
          throw new Error(data.error || "Script generation failed");
        }
      });

      if (!script) {
        throw new Error("No script generated");
      }

      // Step 2: Record video
      setProgress("Starting recording...");
      let artifactId: number | null = null;
      const recordResponse = await generateDemo(ctx.appId, ctx.itemId, script);
      await consumeSSE(recordResponse, (eventType, data) => {
        if (eventType === "progress") {
          setProgress(data.message || "Recording...");
        } else if (eventType === "status" && data.artifact_id) {
          artifactId = data.artifact_id;
        } else if (eventType === "error") {
          throw new Error(data.error || "Recording failed");
        }
      });

      videoUrl = artifactId
        ? getDemoVideoUrlByArtifact(ctx.appId, artifactId)
        : getDemoVideoUrl(ctx.appId, ctx.itemId);
    } catch (err) {
      error = err instanceof Error ? err.message : "Recording failed";
    }

    if (videoUrl) {
      await ctx.saveMessage(JSON.stringify({ videoUrl }), "assistant", "video");
    } else {
      await ctx.saveMessage(JSON.stringify({ error: error || "Recording failed" }), "assistant", "video");
    }
    await ctx.reloadMessages();
    setBusy(false);
    setProgress(null);
  }, [busy, ctx]);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setBusy(false);
    setProgress(null);
  }, []);

  return { execute, cancel, busy, progress };
}

function VideoProgress({ progress }: { progress: string | null }) {
  return (
    <div className="flex items-start gap-2.5 animate-fadeIn">
      <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-1">
        <VideoCamera size={14} weight="bold" className="text-blue-400" />
      </div>
      <div className="bg-th-surface border border-th rounded-2xl rounded-tl-md px-4 py-3">
        <div className="flex items-center gap-2">
          <SpinnerGap size={14} className="animate-spin text-blue-400" />
          <span className="text-sm text-th-secondary">
            {progress || "Preparing video..."}
          </span>
        </div>
      </div>
    </div>
  );
}

function VideoResult({ content, appId, itemId }: { content: string; appId: number; itemId: number }) {
  let videoUrl: string | null = null;
  let error: string | null = null;
  try {
    const parsed = JSON.parse(content);
    videoUrl = parsed.videoUrl || null;
    error = parsed.error || null;
  } catch {}

  if (error || !videoUrl) {
    return (
      <div className="flex items-start gap-2.5 animate-fadeIn">
        <div className="w-7 h-7 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-1">
          <VideoCamera size={14} weight="bold" className="text-red-400" />
        </div>
        <div className="bg-st-red border border-st-red rounded-2xl rounded-tl-md px-4 py-3">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-1">Recording Failed</p>
          <p className="text-sm text-red-300">{error || "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 animate-fadeIn">
      <div className="w-7 h-7 rounded-full bg-brand-400/20 flex items-center justify-center flex-shrink-0 mt-1">
        <VideoCamera size={14} weight="bold" className="text-brand-300" />
      </div>
      <div className="bg-th-surface border border-th rounded-2xl rounded-tl-md overflow-hidden max-w-[80%]">
        <div className="px-4 pt-3 pb-2">
          <p className="text-xs font-semibold text-th-muted uppercase tracking-wide">Demo Video</p>
        </div>
        <div className="px-2 pb-2">
          <video
            src={videoUrl}
            controls
            className="w-full rounded-lg max-h-[400px]"
            preload="metadata"
          />
        </div>
        <div className="px-4 pb-3 flex items-center gap-2">
          <a
            href={videoUrl}
            download={`demo-${itemId}.mp4`}
            className="text-[11px] px-2.5 py-1 bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover font-medium transition-colors flex items-center gap-1"
          >
            <DownloadSimple size={12} weight="bold" />
            Download
          </a>
        </div>
      </div>
    </div>
  );
}

export const recordVideo: Tool = {
  ...recordVideoDefinition,
  icon: VideoCamera,
  useTool: useRecordVideoTool,
  ProgressCard: VideoProgress,
  ResultCard: VideoResult,
};
