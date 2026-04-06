"use client";

import { useState, useRef, useCallback } from "react";
import { generateSeed } from "@/lib/api";
import { Database, Users, Check, Warning, SpinnerGap } from "@phosphor-icons/react";
import type { DemoPersona } from "@/lib/types";
import type { Tool, ToolContext, ToolState } from "../types";
import { seedDefinition } from "./definition";
import { ensurePreviewRunning } from "../ensurePreview";

interface SeedActivity {
  tool?: string;
  type: string;
  detail: string;
}

function useSeedTool(ctx: ToolContext): ToolState {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [activities, setActivities] = useState<SeedActivity[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const execute = useCallback(async (input: string) => {
    if (busy) return;
    setBusy(true);
    setProgress("Starting seed generation...");
    setActivities([]);

    const trackedActivities: SeedActivity[] = [];
    let personas: DemoPersona[] = [];
    let seedScript: string | null = null;
    let seedOutput: string | null = null;
    let error: string | null = null;

    try {
      // Ensure preview is running before seeding (seed may need the app server)
      const previewReady = await ensurePreviewRunning(ctx, setProgress);
      if (!previewReady) {
        await ctx.saveMessage("Could not start the preview. Please start it manually and try again.", "assistant");
        await ctx.reloadMessages();
        return;
      }

      const response = await generateSeed(ctx.appId, ctx.itemId, input || undefined);
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
            const parsed = JSON.parse(dataStr);
            if (eventType === "activity") {
              trackedActivities.push({
                tool: parsed.tool,
                type: parsed.type,
                detail: parsed.detail,
              });
              setActivities([...trackedActivities]);
            } else if (eventType === "progress") {
              setProgress(parsed.message || null);
            } else if (eventType === "seed_result") {
              personas = parsed.personas || [];
              seedScript = parsed.script || null;
              seedOutput = parsed.seedOutput || null;
            } else if (eventType === "error") {
              error = parsed.error || "Seed generation failed";
            }
          } catch {}
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Seed generation failed";
    }

    await ctx.saveMessage(JSON.stringify({ personas, seedScript, seedOutput, error }), "assistant", "seed");
    await ctx.reloadMessages();
    setBusy(false);
    setProgress(null);
    setActivities([]);
  }, [busy, ctx]);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setBusy(false);
    setProgress(null);
    setActivities([]);
  }, []);

  return { execute, cancel, busy, progress };
}

function SeedProgress({ progress }: { progress: string | null }) {
  return (
    <div className="flex items-start gap-2.5 animate-fadeIn">
      <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-1">
        <Database size={14} weight="bold" className="text-green-400" />
      </div>
      <div className="bg-th-surface border border-th rounded-2xl rounded-tl-md px-4 py-3 max-w-[80%]">
        <div className="flex items-center gap-2 mb-2">
          <SpinnerGap size={14} className="animate-spin text-green-400" />
          <span className="text-xs font-semibold text-th-muted uppercase tracking-wide">Seeding Database</span>
        </div>
        {progress && (
          <p className="text-sm text-th-secondary mb-1">{progress}</p>
        )}
      </div>
    </div>
  );
}

function SeedResult({ content }: { content: string; appId: number; itemId: number }) {
  const [showScript, setShowScript] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  let personas: DemoPersona[] = [];
  let seedScript: string | null = null;
  let seedOutput: string | null = null;
  let error: string | null = null;
  try {
    const parsed = JSON.parse(content);
    personas = parsed.personas || [];
    seedScript = parsed.seedScript || null;
    seedOutput = parsed.seedOutput || null;
    error = parsed.error || null;
  } catch {}

  if (error) {
    return (
      <div className="flex items-start gap-2.5 animate-fadeIn">
        <div className="w-7 h-7 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-1">
          <Warning size={14} weight="bold" className="text-red-400" />
        </div>
        <div className="bg-st-red border border-st-red rounded-2xl rounded-tl-md px-4 py-3 max-w-[80%]">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-1">Seed Failed</p>
          <p className="text-sm text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 animate-fadeIn">
      <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-1">
        <Check size={14} weight="bold" className="text-green-400" />
      </div>
      <div className="bg-th-surface border border-th rounded-2xl rounded-tl-md px-4 py-3 max-w-[80%]">
        <p className="text-xs font-semibold text-th-muted uppercase tracking-wide mb-2">Database Seeded</p>

        {/* Personas */}
        {personas.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {personas.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-th-secondary flex-wrap">
                <Users size={14} className="text-th-muted flex-shrink-0" />
                <span className="font-medium">{p.name}</span>
                {p.email && <span className="text-th-dimmed text-xs">{p.email}</span>}
                {p.username && <span className="text-th-dimmed text-xs font-mono">@{p.username}</span>}
                {p.password && <span className="text-th-dimmed text-xs font-mono">{p.password}</span>}
              </div>
            ))}
          </div>
        )}

        {personas.length === 0 && (
          <p className="text-sm text-th-secondary mb-3">Seed data created successfully.</p>
        )}

        {/* Collapsible sections */}
        <div className="flex flex-wrap gap-1.5">
          {seedScript && (
            <button
              onClick={() => setShowScript(!showScript)}
              className="text-[11px] px-2 py-0.5 rounded-md bg-th-muted text-th-muted hover:text-th-secondary transition-colors"
            >
              {showScript ? "Hide script" : "Show script"}
            </button>
          )}
          {seedOutput && (
            <button
              onClick={() => setShowOutput(!showOutput)}
              className="text-[11px] px-2 py-0.5 rounded-md bg-th-muted text-th-muted hover:text-th-secondary transition-colors"
            >
              {showOutput ? "Hide output" : "Show output"}
            </button>
          )}
        </div>

        {showScript && seedScript && (
          <pre className="mt-2 p-3 bg-th-code text-code-block rounded-lg text-xs overflow-x-auto max-h-60 overflow-y-auto">
            {seedScript}
          </pre>
        )}

        {showOutput && seedOutput && (
          <pre className="mt-2 p-3 bg-th-code text-code-block rounded-lg text-xs overflow-x-auto max-h-60 overflow-y-auto">
            {seedOutput}
          </pre>
        )}
      </div>
    </div>
  );
}

export const seed: Tool = {
  ...seedDefinition,
  icon: Database,
  useTool: useSeedTool,
  ProgressCard: SeedProgress,
  ResultCard: SeedResult,
};
