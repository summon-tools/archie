/**
 * Knowledge job tracker — backed by the SQLite `runs` table (RFC 22).
 *
 * Same public API as before so callers (indexer.ts, /api/jobs/active) don't change.
 * Uses workflow_key = 'knowledge_index'.
 */

import * as dal from "../dal";
import type { RunRow } from "../types";
import type { KnowledgeJob } from "./types";

const WORKFLOW_KEY = "knowledge_index";

// ── In-memory cache: appId → runId (optimization only) ──────────

const _runIdCache = new Map<number, number>();

function runToKnowledgeJob(run: RunRow): KnowledgeJob {
  return {
    status: run.status === "stopped" ? "failed" : run.status as KnowledgeJob["status"],
    progress: run.progress_text || "",
    error: run.error_text || null,
    started_at: new Date(run.created_at).getTime(),
  };
}

function findActiveKnowledgeRun(appId: number): RunRow | undefined {
  const cachedId = _runIdCache.get(appId);
  if (cachedId) {
    const run = dal.getRun(cachedId);
    if (run && run.status === "running") return run;
    _runIdCache.delete(appId);
  }

  const run = dal.getActiveRunByWorkflow(appId, WORKFLOW_KEY);
  if (run) {
    _runIdCache.set(appId, run.id);
  }
  return run;
}

// ── Public API (unchanged signatures) ────────────────────────────

export function getKnowledgeJob(appId: number): KnowledgeJob | null {
  const run = findActiveKnowledgeRun(appId);
  if (!run) return null;
  return runToKnowledgeJob(run);
}

export function setKnowledgeJob(appId: number, job: KnowledgeJob): void {
  const run = dal.createRun({
    app_id: appId,
    workflow_key: WORKFLOW_KEY,
    status: "running",
    progress_text: job.progress,
  });
  _runIdCache.set(appId, run.id);
}

export function updateKnowledgeJob(appId: number, updates: Partial<KnowledgeJob>): void {
  const run = findActiveKnowledgeRun(appId);
  if (!run) return;

  const fields: Record<string, unknown> = {};
  if (updates.progress !== undefined) fields.progress_text = updates.progress;
  if (updates.status !== undefined) fields.status = updates.status;
  if (updates.error !== undefined) fields.error_text = updates.error;

  if (Object.keys(fields).length > 0) {
    dal.updateRun(run.id, fields as any);
  }
}

export function clearKnowledgeJob(appId: number): void {
  const run = findActiveKnowledgeRun(appId);
  if (run) {
    dal.updateRun(run.id, { status: "failed", failure_category: "cleared" });
  }
  _runIdCache.delete(appId);
}

export function getAllRunningKnowledgeJobs(): { appId: number; job: KnowledgeJob }[] {
  const activeRuns = dal.getActiveRuns();
  const result: { appId: number; job: KnowledgeJob }[] = [];
  for (const run of activeRuns) {
    if (run.workflow_key === WORKFLOW_KEY) {
      result.push({ appId: run.app_id, job: runToKnowledgeJob(run) });
    }
  }
  return result;
}
