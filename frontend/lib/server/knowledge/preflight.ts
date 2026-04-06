/**
 * Preflight checks — validate prerequisites before starting a run.
 */

import fs from "fs";
import { execSync } from "child_process";
import { getProvider } from "../agent";
import { getDefaultProvider } from "../config";
import * as dal from "../dal";
import { getAllKnowledge } from "./store";

export interface PreflightResult {
  ok: boolean;
  warnings: string[];
  blockers: string[];
}

// Cache provider availability — invalidated on login or settings change
let _providerCache: { ok: boolean } | null = null;

/** Clear cached provider availability — call on login or after API key changes. */
export function clearProviderCache(): void {
  _providerCache = null;
}

/**
 * Run preflight checks before starting a workflow.
 */
export async function preflightCheck(params: {
  appId: number;
  directory: string;
  workItemId?: number;
  workflow: string;
}): Promise<PreflightResult> {
  const warnings: string[] = [];
  const blockers: string[] = [];

  // Check directory exists
  if (!fs.existsSync(params.directory)) {
    blockers.push(`Directory not found: ${params.directory}`);
    return { ok: false, warnings, blockers };
  }

  // Check git repo valid
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: params.directory,
      encoding: "utf-8",
      timeout: 3000,
      stdio: "pipe",
    });
  } catch {
    warnings.push("Directory is not a git repository");
  }

  // Check provider available (cached until invalidated by login or settings change)
  if (_providerCache) {
    if (!_providerCache.ok) {
      blockers.push("AI provider is not available. Check your API key and connection.");
    }
  } else {
    try {
      const providerId = getDefaultProvider();
      const provider = getProvider(providerId);
      const available = await provider.isAvailable();
      _providerCache = { ok: available };
      if (!available) {
        blockers.push(`AI provider "${providerId}" is not available. Check your API key and connection.`);
      }
    } catch (e: any) {
      _providerCache = { ok: false };
      blockers.push(`Failed to check AI provider: ${e.message || String(e)}`);
    }
  }

  // Check worktree ready (for task workflows)
  if (params.workItemId && params.workflow === "stream") {
    const env = dal.getWorkItemEnv(params.workItemId);
    if (env?.worktree_status === "failed") {
      blockers.push("Worktree creation failed. Try recreating the work item environment.");
    }
  }

  // Check codebase index artifacts present (warn if missing)
  const knowledge = getAllKnowledge(params.appId);
  if (knowledge.length === 0) {
    warnings.push("No codebase index available yet. Project context will be limited until indexing completes.");
  }

  return {
    ok: blockers.length === 0,
    warnings,
    blockers,
  };
}
