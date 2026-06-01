import { getDb } from "../db";
import type { LlmAttributionConfidence, LlmOutcomeFollowupRelation, LlmOutcomeFollowupRow } from "../types";

export interface UpsertLlmOutcomeFollowupInput {
  app_id: number;
  source_work_item_id: number;
  source_snapshot_id: number;
  source_pr_snapshot_id: number;
  followup_repo_pr_id: number;
  owner: string;
  repo: string;
  source_pr_number: number;
  followup_pr_number: number;
  relation_type: LlmOutcomeFollowupRelation;
  confidence: LlmAttributionConfidence;
  deterministic_score: number;
  deterministic_signals_json?: string | null;
  assessment_json?: string | null;
  evidence_json?: string | null;
  detected_at?: string;
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

export function upsertLlmOutcomeFollowup(input: UpsertLlmOutcomeFollowupInput): LlmOutcomeFollowupRow {
  const detectedAt = input.detected_at || new Date().toISOString();
  getDb().prepare(
    `INSERT INTO llm_outcome_followups (
      app_id, source_work_item_id, source_snapshot_id, source_pr_snapshot_id, followup_repo_pr_id,
      owner, repo, source_pr_number, followup_pr_number, relation_type, confidence,
      deterministic_score, deterministic_signals_json, assessment_json, evidence_json, detected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_snapshot_id, followup_repo_pr_id) DO UPDATE SET
      relation_type = excluded.relation_type,
      confidence = excluded.confidence,
      deterministic_score = excluded.deterministic_score,
      deterministic_signals_json = excluded.deterministic_signals_json,
      assessment_json = excluded.assessment_json,
      evidence_json = excluded.evidence_json,
      detected_at = excluded.detected_at`
  ).run(
    input.app_id,
    input.source_work_item_id,
    input.source_snapshot_id,
    input.source_pr_snapshot_id,
    input.followup_repo_pr_id,
    input.owner,
    input.repo,
    input.source_pr_number,
    input.followup_pr_number,
    input.relation_type,
    input.confidence,
    input.deterministic_score,
    input.deterministic_signals_json ?? null,
    input.assessment_json ?? null,
    input.evidence_json ?? null,
    detectedAt,
  );
  return getDb()
    .prepare("SELECT * FROM llm_outcome_followups WHERE source_snapshot_id = ? AND followup_repo_pr_id = ?")
    .get(input.source_snapshot_id, input.followup_repo_pr_id) as LlmOutcomeFollowupRow;
}

export function listLlmOutcomeFollowupsForWorkItems(workItemIds: number[]): LlmOutcomeFollowupRow[] {
  if (workItemIds.length === 0) return [];
  return getDb()
    .prepare(`SELECT * FROM llm_outcome_followups WHERE source_work_item_id IN (${placeholders(workItemIds.length)}) ORDER BY detected_at DESC, id DESC`)
    .all(...workItemIds) as LlmOutcomeFollowupRow[];
}
