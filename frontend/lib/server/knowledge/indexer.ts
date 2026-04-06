/**
 * Background knowledge indexer.
 * Uses the provider's toolEnabledStream to explore a codebase
 * and produce dynamic knowledge sections.
 */

import { getProvider } from "../agent";
import { getBackgroundModel, getBackgroundProvider } from "../config";
import { setKnowledge } from "./store";
import { isKnowledgeStale } from "./store";
import { getKnowledgeJob, setKnowledgeJob, updateKnowledgeJob } from "./jobs";
import type { KnowledgeSection } from "./types";
import { buildKnowledgeIndexerPrompt } from "../prompts/knowledge";

/**
 * Index an app's codebase. Claude explores the repo and decides what topics
 * are relevant, always including a "brief" topic.
 */
export async function indexApp(appId: number, directory: string): Promise<void> {
  // Don't start if already running
  const existing = getKnowledgeJob(appId);
  if (existing?.status === "running") return;

  setKnowledgeJob(appId, {
    status: "running",
    progress: "Starting...",
    error: null,
    started_at: Date.now(),
  });

  try {
    const providerId = getBackgroundProvider();
    const provider = getProvider(providerId);

    const prompt = buildKnowledgeIndexerPrompt({ directory });

    updateKnowledgeJob(appId, { progress: "Exploring codebase..." });

    let resultText = "";
    const stream = provider.toolEnabledStream(prompt, {
      model: getBackgroundModel(),
      cwd: directory,
    });

    for await (const event of stream) {
      if (event.type === "tool_use") {
        updateKnowledgeJob(appId, { progress: `Reading: ${event.detail.slice(0, 100)}` });
      } else if (event.type === "text") {
        updateKnowledgeJob(appId, { progress: event.detail.slice(0, 100) });
      } else if (event.type === "result" && event.resultText) {
        resultText = event.resultText;
      }
    }

    if (!resultText) {
      updateKnowledgeJob(appId, { status: "failed", error: "No result from indexer" });
      return;
    }

    updateKnowledgeJob(appId, { progress: "Storing codebase index..." });

    // Parse the JSON array
    let sections: KnowledgeSection[];
    try {
      const cleaned = resultText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      sections = JSON.parse(cleaned);
    } catch {
      const match = resultText.match(/\[[\s\S]*\]/);
      if (!match) {
        updateKnowledgeJob(appId, { status: "failed", error: "Failed to parse indexer output" });
        return;
      }
      sections = JSON.parse(match[0]);
    }

    if (!Array.isArray(sections) || sections.length === 0) {
      updateKnowledgeJob(appId, { status: "failed", error: "No codebase index sections produced" });
      return;
    }

    // Store each section
    for (const section of sections) {
      if (!section.topic || !section.content) continue;
      setKnowledge(appId, {
        topic: section.topic,
        label: section.label || section.topic,
        content: section.content,
      }, directory);
    }

    updateKnowledgeJob(appId, {
      status: "completed",
      progress: `Indexed ${sections.length} topics`,
    });
  } catch (e: any) {
    updateKnowledgeJob(appId, { status: "failed", error: e.message || String(e) });
  }
}

/**
 * Refresh knowledge if stale. Fire-and-forget safe.
 * Guarded against concurrent runs — if already refreshing, this is a no-op.
 */
let _refreshing = false;

export async function refreshIfStale(appId: number, directory: string, maxAgeSeconds = 3600): Promise<void> {
  if (_refreshing) return;
  if (!isKnowledgeStale(appId, maxAgeSeconds)) return;
  _refreshing = true;
  try {
    await indexApp(appId, directory);
  } finally {
    _refreshing = false;
  }
}
