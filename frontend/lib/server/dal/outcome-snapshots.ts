import { getDb } from "../db";
import type {
  LlmAttributionClassification,
  LlmAttributionConfidence,
  LlmOutcomeConfidence,
  LlmOutcomeQualityBand,
  LlmOutcomeSnapshotRow,
  LlmOutcomeState,
} from "../types";

export interface UpsertLlmOutcomeSnapshotInput {
  app_id: number;
  work_item_id: number;
  conversation_id?: number | null;
  session_id?: number | null;
  pr_snapshot_id?: number | null;
  pr_author_login?: string | null;
  pr_author_classification?: LlmAttributionClassification;
  pr_author_confidence?: LlmAttributionConfidence;
  attribution_confidence?: LlmAttributionConfidence;
  outcome_state: LlmOutcomeState;
  quality_band: LlmOutcomeQualityBand;
  confidence: LlmOutcomeConfidence;
  known_cost_usd?: number | null;
  unknown_cost_runs: number;
  issue_comment_count: number;
  review_comment_count: number;
  review_count: number;
  commit_count: number;
  human_commit_count: number;
  agent_commit_count: number;
  coauthored_commit_count: number;
  unknown_commit_count: number;
  human_after_agent_commit_count: number;
  correction_burden_score: number;
  evidence_json?: string | null;
  computed_at?: string;
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

export function upsertLlmOutcomeSnapshot(input: UpsertLlmOutcomeSnapshotInput): LlmOutcomeSnapshotRow {
  const computedAt = input.computed_at || new Date().toISOString();
  getDb().prepare(
    `INSERT INTO llm_outcome_snapshots (
      app_id, work_item_id, conversation_id, session_id, pr_snapshot_id, pr_author_login,
      pr_author_classification, pr_author_confidence, attribution_confidence, outcome_state,
      quality_band, confidence, known_cost_usd, unknown_cost_runs, issue_comment_count,
      review_comment_count, review_count, commit_count, human_commit_count,
      agent_commit_count, coauthored_commit_count, unknown_commit_count,
      human_after_agent_commit_count, correction_burden_score, evidence_json, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(work_item_id) DO UPDATE SET
      app_id = excluded.app_id,
      conversation_id = excluded.conversation_id,
      session_id = excluded.session_id,
      pr_snapshot_id = excluded.pr_snapshot_id,
      pr_author_login = excluded.pr_author_login,
      pr_author_classification = excluded.pr_author_classification,
      pr_author_confidence = excluded.pr_author_confidence,
      attribution_confidence = excluded.attribution_confidence,
      outcome_state = excluded.outcome_state,
      quality_band = excluded.quality_band,
      confidence = excluded.confidence,
      known_cost_usd = excluded.known_cost_usd,
      unknown_cost_runs = excluded.unknown_cost_runs,
      issue_comment_count = excluded.issue_comment_count,
      review_comment_count = excluded.review_comment_count,
      review_count = excluded.review_count,
      commit_count = excluded.commit_count,
      human_commit_count = excluded.human_commit_count,
      agent_commit_count = excluded.agent_commit_count,
      coauthored_commit_count = excluded.coauthored_commit_count,
      unknown_commit_count = excluded.unknown_commit_count,
      human_after_agent_commit_count = excluded.human_after_agent_commit_count,
      correction_burden_score = excluded.correction_burden_score,
      evidence_json = excluded.evidence_json,
      computed_at = excluded.computed_at`
  ).run(
    input.app_id,
    input.work_item_id,
    input.conversation_id ?? null,
    input.session_id ?? null,
    input.pr_snapshot_id ?? null,
    input.pr_author_login ?? null,
    input.pr_author_classification ?? "unknown",
    input.pr_author_confidence ?? "unknown",
    input.attribution_confidence ?? "unknown",
    input.outcome_state,
    input.quality_band,
    input.confidence,
    input.known_cost_usd ?? null,
    input.unknown_cost_runs,
    input.issue_comment_count,
    input.review_comment_count,
    input.review_count,
    input.commit_count,
    input.human_commit_count,
    input.agent_commit_count,
    input.coauthored_commit_count,
    input.unknown_commit_count,
    input.human_after_agent_commit_count,
    input.correction_burden_score,
    input.evidence_json ?? null,
    computedAt,
  );
  return getLlmOutcomeSnapshotForWorkItem(input.work_item_id)!;
}

export function getLlmOutcomeSnapshotForWorkItem(workItemId: number): LlmOutcomeSnapshotRow | undefined {
  return getDb()
    .prepare("SELECT * FROM llm_outcome_snapshots WHERE work_item_id = ?")
    .get(workItemId) as LlmOutcomeSnapshotRow | undefined;
}

export function listLlmOutcomeSnapshotsForWorkItems(workItemIds: number[]): LlmOutcomeSnapshotRow[] {
  if (workItemIds.length === 0) return [];
  return getDb()
    .prepare(`SELECT * FROM llm_outcome_snapshots WHERE work_item_id IN (${placeholders(workItemIds.length)})`)
    .all(...workItemIds) as LlmOutcomeSnapshotRow[];
}
