import { getDb } from "../db";
import type { LlmOutcomeReportRow } from "../types";

export interface CreateLlmOutcomeReportInput {
  requested_by_user_id?: number | null;
  mode?: "manual" | "scheduled";
  status?: "completed" | "failed";
  range_start?: string | null;
  range_end?: string | null;
  range_days?: number | null;
  total_work_items?: number;
  resolved_pr_count?: number;
  report_json?: string | null;
  warnings_json?: string | null;
  error_text?: string | null;
  generated_at?: string;
}

export function createLlmOutcomeReport(input: CreateLlmOutcomeReportInput): LlmOutcomeReportRow {
  const generatedAt = input.generated_at || new Date().toISOString();
  const result = getDb().prepare(
    `INSERT INTO llm_outcome_reports (
      requested_by_user_id, mode, status, range_start, range_end, range_days,
      total_work_items, resolved_pr_count, report_json, warnings_json, error_text, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.requested_by_user_id ?? null,
    input.mode || "manual",
    input.status || "completed",
    input.range_start ?? null,
    input.range_end ?? null,
    input.range_days ?? null,
    input.total_work_items ?? 0,
    input.resolved_pr_count ?? 0,
    input.report_json ?? null,
    input.warnings_json ?? null,
    input.error_text ?? null,
    generatedAt,
  );
  return getLlmOutcomeReport(Number(result.lastInsertRowid))!;
}

export function getLlmOutcomeReport(id: number): LlmOutcomeReportRow | undefined {
  return getDb()
    .prepare("SELECT * FROM llm_outcome_reports WHERE id = ?")
    .get(id) as LlmOutcomeReportRow | undefined;
}

export function getLatestLlmOutcomeReport(): LlmOutcomeReportRow | undefined {
  return getDb()
    .prepare("SELECT * FROM llm_outcome_reports ORDER BY generated_at DESC, id DESC LIMIT 1")
    .get() as LlmOutcomeReportRow | undefined;
}
