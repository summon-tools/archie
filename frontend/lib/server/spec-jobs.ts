/**
 * Spec job tracker — backed by the SQLite `runs` table (RFC 22).
 *
 * Keeps the same public API surface so callers don't need to change.
 * A small in-memory appId → runId cache avoids repeated DB lookups
 * during active jobs. On cache miss we fall back to a query.
 */

import * as dal from "./dal";
import { getDb } from "./db";
import type { RunRow } from "./types";

export interface SpecJob {
  type: "generate" | "validate" | "update_specs";
  status: "running" | "completed" | "failed";
  progress: string;
  error: string | null;
  result: any | null;
  started_at: number;
}

// ── In-memory cache: appId → runId (optimization only) ──────────

const _runIdCache = new Map<number, number>();

const SPEC_WORKFLOW_KEYS = ["spec_generate", "spec_validate", "spec_update_specs"] as const;

function workflowKeyForType(type: SpecJob["type"]): string {
  return `spec_${type}`;
}

function typeFromWorkflowKey(key: string): SpecJob["type"] {
  const suffix = key.replace(/^spec_/, "");
  if (suffix === "generate" || suffix === "validate" || suffix === "update_specs") return suffix;
  return "generate"; // fallback
}

function runToSpecJob(run: RunRow): SpecJob {
  const stateJson = run.state_json ? JSON.parse(run.state_json) : {};
  const resultJson = run.result_json ? JSON.parse(run.result_json) : null;
  return {
    type: typeFromWorkflowKey(run.workflow_key || "spec_generate"),
    status: run.status === "stopped" ? "failed" : run.status as SpecJob["status"],
    progress: run.progress_text || stateJson.progress || "",
    error: run.error_text || null,
    result: resultJson,
    started_at: new Date(run.created_at).getTime(),
  };
}

// ── Find the active run for an app across all spec workflow keys ──

function findActiveSpecRun(appId: number): RunRow | undefined {
  // Check cache first
  const cachedId = _runIdCache.get(appId);
  if (cachedId) {
    const run = dal.getRun(cachedId);
    if (run && run.status === "running") return run;
    _runIdCache.delete(appId);
  }

  // Fallback: query each spec workflow key
  for (const wk of SPEC_WORKFLOW_KEYS) {
    const run = dal.getActiveRunByWorkflow(appId, wk);
    if (run) {
      _runIdCache.set(appId, run.id);
      return run;
    }
  }
  return undefined;
}

// ── Find the most recent spec run (any status) for an app ─────────

function findLatestSpecRun(appId: number): RunRow | undefined {
  // Check cache first for active run
  const active = findActiveSpecRun(appId);
  if (active) return active;

  // Query for any recent completed/failed spec run (latest first)
  const db = getDb();
  return db.prepare(
    `SELECT * FROM runs
     WHERE app_id = ? AND workflow_key IN ('spec_generate', 'spec_validate', 'spec_update_specs')
     ORDER BY created_at DESC LIMIT 1`
  ).get(appId) as RunRow | undefined;
}

// ── Public API (unchanged signatures) ────────────────────────────

export function getSpecJob(appId: number): SpecJob | null {
  const run = findLatestSpecRun(appId);
  if (!run) return null;
  return runToSpecJob(run);
}

export function setSpecJob(appId: number, job: SpecJob): void {
  const run = dal.createRun({
    app_id: appId,
    workflow_key: workflowKeyForType(job.type),
    status: "running",
    progress_text: job.progress,
  });
  _runIdCache.set(appId, run.id);
}

export function updateSpecJob(appId: number, updates: Partial<SpecJob>): void {
  const run = findActiveSpecRun(appId);
  if (!run) return;

  const fields: Record<string, unknown> = {};
  if (updates.progress !== undefined) fields.progress_text = updates.progress;
  if (updates.status !== undefined) fields.status = updates.status;
  if (updates.error !== undefined) fields.error_text = updates.error;
  if (updates.result !== undefined) fields.result_json = JSON.stringify(updates.result);

  if (Object.keys(fields).length > 0) {
    dal.updateRun(run.id, fields as any);
  }
}

export function clearSpecJob(appId: number): void {
  const run = findActiveSpecRun(appId);
  if (run) {
    dal.updateRun(run.id, { status: "failed", failure_category: "cleared" });
  }
  _runIdCache.delete(appId);
}

export function getAllRunningSpecJobs(): { appId: number; job: SpecJob }[] {
  const activeRuns = dal.getActiveRuns();
  const result: { appId: number; job: SpecJob }[] = [];
  for (const run of activeRuns) {
    if (run.workflow_key && run.workflow_key.startsWith("spec_")) {
      result.push({ appId: run.app_id, job: runToSpecJob(run) });
    }
  }
  return result;
}
