/**
 * Shared SDK helpers for ephemeral (tool-free) queries.
 * Routes to the correct provider based on model category.
 */

import { getProvider } from "./agent";
import { getModelForCategory, type ModelCategory } from "./config";

// Re-export types for existing callers
export type { ToolStreamEvent as ToolActivity } from "./agent";

export interface ToolEnabledQueryOptions {
  model?: string;
  maxTurns?: number;
  abortController?: AbortController;
  cwd?: string;
  category?: ModelCategory;
}

/**
 * Run a tool-free one-shot query and return the text result.
 * Routes to the correct provider based on category (default: "background").
 */
export async function runEphemeralQuery(
  prompt: string,
  opts?: { model?: string; maxTurns?: number; abortController?: AbortController; category?: ModelCategory }
): Promise<string> {
  const category = opts?.category || "background";
  const resolved = getModelForCategory(category);
  const model = opts?.model || resolved.model;
  return getProvider(resolved.provider).ephemeralQuery(prompt, { ...opts, model });
}

/**
 * Run an SDK query with tools enabled, yielding activity events as they happen.
 * Routes to the correct provider based on category (default: "background").
 */
export async function* runToolEnabledStream(
  prompt: string,
  opts?: ToolEnabledQueryOptions
): AsyncGenerator<import("./agent").ToolStreamEvent, void, undefined> {
  const category = opts?.category || "background";
  const resolved = getModelForCategory(category);
  const model = opts?.model || resolved.model;
  yield* getProvider(resolved.provider).toolEnabledStream(prompt, { ...opts, model });
}
