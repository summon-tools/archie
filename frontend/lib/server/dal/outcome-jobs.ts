import { getDb } from "../db";
import type { LlmOutcomeJobKind, LlmOutcomeJobRow, LlmOutcomeJobStatus } from "../types";

export interface CreateLlmOutcomeJobInput {
  kind: LlmOutcomeJobKind;
  requested_by_user_id?: number | null;
  input_json?: string | null;
  progress_text?: string | null;
}

export interface UpdateLlmOutcomeJobInput {
  status?: LlmOutcomeJobStatus;
  result_json?: string | null;
  progress_text?: string | null;
  error_text?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export function createLlmOutcomeJob(input: CreateLlmOutcomeJobInput): LlmOutcomeJobRow {
  const result = getDb().prepare(
    `INSERT INTO llm_outcome_jobs (
      kind, requested_by_user_id, input_json, progress_text
    ) VALUES (?, ?, ?, ?)`
  ).run(
    input.kind,
    input.requested_by_user_id ?? null,
    input.input_json ?? null,
    input.progress_text ?? null,
  );
  return getLlmOutcomeJob(Number(result.lastInsertRowid))!;
}

export function updateLlmOutcomeJob(id: number, fields: UpdateLlmOutcomeJobInput): LlmOutcomeJobRow {
  const setParts: string[] = [];
  const values: unknown[] = [];
  if (fields.status !== undefined) {
    setParts.push("status = ?");
    values.push(fields.status);
  }
  if (fields.result_json !== undefined) {
    setParts.push("result_json = ?");
    values.push(fields.result_json);
  }
  if (fields.progress_text !== undefined) {
    setParts.push("progress_text = ?");
    values.push(fields.progress_text);
  }
  if (fields.error_text !== undefined) {
    setParts.push("error_text = ?");
    values.push(fields.error_text);
  }
  if (fields.started_at !== undefined) {
    setParts.push("started_at = ?");
    values.push(fields.started_at);
  }
  if (fields.completed_at !== undefined) {
    setParts.push("completed_at = ?");
    values.push(fields.completed_at);
  }
  if (setParts.length === 0) return getLlmOutcomeJob(id)!;
  setParts.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE llm_outcome_jobs SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
  return getLlmOutcomeJob(id)!;
}

export function getLlmOutcomeJob(id: number): LlmOutcomeJobRow | undefined {
  return getDb()
    .prepare("SELECT * FROM llm_outcome_jobs WHERE id = ?")
    .get(id) as LlmOutcomeJobRow | undefined;
}

export function getLatestLlmOutcomeJob(kind?: LlmOutcomeJobKind): LlmOutcomeJobRow | undefined {
  if (kind) {
    return getDb()
      .prepare("SELECT * FROM llm_outcome_jobs WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(kind) as LlmOutcomeJobRow | undefined;
  }
  return getDb()
    .prepare("SELECT * FROM llm_outcome_jobs ORDER BY created_at DESC, id DESC LIMIT 1")
    .get() as LlmOutcomeJobRow | undefined;
}
