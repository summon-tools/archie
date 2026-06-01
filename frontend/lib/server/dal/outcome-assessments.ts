import { getDb } from "../db";
import type { LlmAttributionConfidence, LlmOutcomeAssessmentRow } from "../types";

export interface CreateLlmOutcomeAssessmentInput {
  app_id: number;
  work_item_id: number;
  snapshot_id: number;
  pr_snapshot_id?: number | null;
  provider_id: string;
  model_id: string;
  input_hash: string;
  status?: "completed" | "failed";
  assessment_json?: string | null;
  confidence?: LlmAttributionConfidence;
  error_text?: string | null;
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

export function createLlmOutcomeAssessment(input: CreateLlmOutcomeAssessmentInput): LlmOutcomeAssessmentRow {
  const result = getDb().prepare(
    `INSERT INTO llm_outcome_assessments (
      app_id, work_item_id, snapshot_id, pr_snapshot_id, provider_id, model_id,
      input_hash, status, assessment_json, confidence, error_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.app_id,
    input.work_item_id,
    input.snapshot_id,
    input.pr_snapshot_id ?? null,
    input.provider_id,
    input.model_id,
    input.input_hash,
    input.status ?? "completed",
    input.assessment_json ?? null,
    input.confidence ?? "unknown",
    input.error_text ?? null,
  );
  return getLlmOutcomeAssessment(Number(result.lastInsertRowid))!;
}

export function getLlmOutcomeAssessment(id: number): LlmOutcomeAssessmentRow | undefined {
  return getDb()
    .prepare("SELECT * FROM llm_outcome_assessments WHERE id = ?")
    .get(id) as LlmOutcomeAssessmentRow | undefined;
}

export function getLatestLlmOutcomeAssessmentForWorkItem(workItemId: number): LlmOutcomeAssessmentRow | undefined {
  return getDb()
    .prepare("SELECT * FROM llm_outcome_assessments WHERE work_item_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(workItemId) as LlmOutcomeAssessmentRow | undefined;
}

export function listLatestLlmOutcomeAssessmentsForWorkItems(workItemIds: number[]): LlmOutcomeAssessmentRow[] {
  if (workItemIds.length === 0) return [];
  return getDb().prepare(`
    SELECT assessment.*
    FROM llm_outcome_assessments assessment
    JOIN (
      SELECT work_item_id, MAX(id) AS max_id
      FROM llm_outcome_assessments
      WHERE work_item_id IN (${placeholders(workItemIds.length)})
      GROUP BY work_item_id
    ) latest ON latest.max_id = assessment.id
  `).all(...workItemIds) as LlmOutcomeAssessmentRow[];
}
