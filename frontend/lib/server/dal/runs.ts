import { getDb } from "../db";
import type { RunRow, RunStatus } from "../types";

export function getRun(runId: number): RunRow | undefined {
  return getDb().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
}

export function createRun(data: {
  app_id: number;
  conversation_id?: number | null;
  work_item_id?: number | null;
  session_id?: number | null;
  workflow_key?: string | null;
  status?: RunStatus;
  provider_id?: string;
  model_id?: string | null;
  input_json?: string | null;
  budget_json?: string | null;
  progress_text?: string | null;
}): RunRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO runs (app_id, conversation_id, work_item_id, session_id, workflow_key, status, provider_id, model_id, input_json, budget_json, progress_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.app_id,
    data.conversation_id ?? null,
    data.work_item_id ?? null,
    data.session_id ?? null,
    data.workflow_key ?? null,
    data.status || "running",
    data.provider_id || "claude",
    data.model_id ?? null,
    data.input_json ?? null,
    data.budget_json ?? null,
    data.progress_text ?? null
  );
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(result.lastInsertRowid) as RunRow;
}

export function updateRun(
  runId: number,
  fields: Partial<Pick<RunRow, "status" | "result_json" | "error_text" | "state_json" | "budget_json" | "failure_category" | "heartbeat_at" | "progress_text">>
): void {
  const db = getDb();
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(fields)) {
    setParts.push(`${key} = ?`);
    values.push(val);
  }
  if (setParts.length === 0) return;
  setParts.push("updated_at = datetime('now')");
  values.push(runId);
  db.prepare(`UPDATE runs SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
}

/** Touch heartbeat_at to signal the run is still alive. */
export function heartbeatRun(runId: number): void {
  getDb().prepare(
    "UPDATE runs SET heartbeat_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(runId);
}

/** All runs currently in 'running' status, newest first. */
export function getActiveRuns(): RunRow[] {
  return getDb().prepare(
    "SELECT * FROM runs WHERE status = 'running' ORDER BY created_at DESC"
  ).all() as RunRow[];
}

/** Active runs for a specific app. */
export function getActiveRunsByApp(appId: number): RunRow[] {
  return getDb().prepare(
    "SELECT * FROM runs WHERE app_id = ? AND status = 'running' ORDER BY created_at DESC"
  ).all(appId) as RunRow[];
}

/** Find the active run for a specific app + workflow combination. */
export function getActiveRunByWorkflow(appId: number, workflowKey: string): RunRow | undefined {
  return getDb().prepare(
    "SELECT * FROM runs WHERE app_id = ? AND workflow_key = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
  ).get(appId, workflowKey) as RunRow | undefined;
}

/**
 * Mark all 'running' runs as failed with failure_category = 'interrupted'.
 * Called at startup to clean up stale runs from a previous crash.
 * Returns the number of runs affected.
 */
export function markInterruptedRuns(): number {
  const result = getDb().prepare(
    "UPDATE runs SET status = 'failed', failure_category = 'interrupted', updated_at = datetime('now') WHERE status = 'running'"
  ).run();
  return result.changes;
}
