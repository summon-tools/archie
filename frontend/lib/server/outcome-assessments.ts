import crypto from "crypto";
import * as dal from "@/lib/server/dal";
import { getDb } from "@/lib/server/db";
import { getModelForCategory } from "@/lib/server/config";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import { normalizeOutcomeEvidenceAssessment } from "@/lib/server/outcome-assessment-rules";
import { recomputeOutcomeSnapshots } from "@/lib/server/outcome-snapshots";
import type {
  AppRow,
  GitHubPrCommentRow,
  GitHubPrCommitRow,
  GitHubPrReviewRow,
  LlmOutcomeAssessmentRow,
  LlmOutcomeSnapshotRow,
} from "@/lib/server/types";
import type { OutcomeEvidenceAssessment } from "@/lib/types";

type AssessmentCandidate = LlmOutcomeSnapshotRow & {
  app_name: string;
  work_item_title: string;
  work_item_status: string;
  owner: string;
  repo: string;
  pr_number: number;
  pr_url: string;
  pr_title: string;
  pr_state: string;
  pr_author_login: string | null;
};

export interface OutcomeAssessmentPacket {
  app: { id: number; name: string };
  work_item: { id: number; title: string; status: string };
  snapshot: {
    id: number;
    outcome_state: string;
    quality_band: string;
    correction_burden_score: number | null;
    issue_comment_count: number;
    review_comment_count: number;
    human_after_agent_commit_count: number;
  };
  pull_request: {
    snapshot_id: number;
    owner: string;
    repo: string;
    number: number;
    url: string;
    title: string;
    state: string;
    author_login: string | null;
  };
  comments: Array<{
    id: string;
    type: "issue" | "review";
    author_login: string | null;
    body: string;
    path: string | null;
    created_at: string | null;
  }>;
  reviews: Array<{
    id: string;
    author_login: string | null;
    state: string | null;
    body: string;
    submitted_at: string | null;
  }>;
  commits: Array<{
    id: string;
    sha: string;
    author_login: string | null;
    committer_login: string | null;
    message: string;
    authored_at: string | null;
    committed_at: string | null;
  }>;
}

export type OutcomeEvidenceAssessor = (packet: OutcomeAssessmentPacket) => Promise<OutcomeEvidenceAssessment>;

export interface RunOutcomeEvidenceAssessmentOptions {
  apps: AppRow[];
  workItemIds?: number[];
  rangeStart?: string | null;
  rangeEnd?: string | null;
  rangeDays?: number | null;
  maxItems?: number;
  force?: boolean;
  assessor?: OutcomeEvidenceAssessor;
}

export interface RunOutcomeEvidenceAssessmentResult {
  assessed_count: number;
  skipped_count: number;
  failed_count: number;
  assessment_ids: number[];
  recomputed_snapshots: number;
  generated_at: string;
  warnings: string[];
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function truncate(value: string | null | undefined, maxLength: number): string {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function hashPacket(packet: OutcomeAssessmentPacket): string {
  return crypto.createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  if (start < 0) throw new Error("Assessment response did not contain a JSON object");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, index + 1);
    }
  }
  throw new Error("Assessment response JSON was incomplete");
}

function parseAssessmentResponse(text: string): OutcomeEvidenceAssessment {
  const parsed = JSON.parse(extractJsonObject(text));
  return normalizeOutcomeEvidenceAssessment(parsed);
}

function buildAssessmentPrompt(packet: OutcomeAssessmentPacket): string {
  return [
    "Classify GitHub review evidence for one Archie LLM-assisted coding work item.",
    "",
    "Return JSON only with exactly this shape:",
    "{",
    "  \"review_pressure\": \"low\" | \"medium\" | \"high\" | \"unknown\",",
    "  \"comment_categories\": {",
    "    \"clarification\": number,",
    "    \"requested_change\": number,",
    "    \"bug_or_regression\": number,",
    "    \"nit\": number,",
    "    \"approval_or_positive\": number,",
    "    \"other\": number",
    "  },",
    "  \"human_followup_type\": \"none\" | \"clarification\" | \"expected_iteration\" | \"agent_correction\" | \"unrelated_extension\" | \"unknown\",",
    "  \"agent_correction_commit_count\": number,",
    "  \"confidence\": \"low\" | \"medium\" | \"high\" | \"unknown\",",
    "  \"evidence_ids\": string[],",
    "  \"summary\": string",
    "}",
    "",
    "Rules:",
    "- Do not score developer productivity or compare people.",
    "- Distinguish clarification/questions from required code changes.",
    "- Treat explicit bug, regression, broken behavior, failing test, or fix-generated-output language as correction evidence.",
    "- Treat normal review questions, approval comments, or unrelated follow-up work as non-correction evidence.",
    "- Only include IDs from the provided comments, reviews, or commits.",
    "- Keep summary under 45 words.",
    "",
    "Evidence packet:",
    JSON.stringify(packet, null, 2),
  ].join("\n");
}

async function defaultAssess(packet: OutcomeAssessmentPacket): Promise<OutcomeEvidenceAssessment> {
  const response = await runEphemeralQuery(buildAssessmentPrompt(packet), {
    category: "quick",
    maxTurns: 1,
  });
  return parseAssessmentResponse(response);
}

function loadCandidates(
  apps: AppRow[],
  options: Pick<RunOutcomeEvidenceAssessmentOptions, "workItemIds" | "rangeStart" | "rangeEnd" | "rangeDays" | "maxItems">,
): AssessmentCandidate[] {
  if (apps.length === 0) return [];
  const appIds = apps.map((app) => app.id);
  const conditions = [
    `snapshot.app_id IN (${placeholders(appIds.length)})`,
    "snapshot.pr_snapshot_id IS NOT NULL",
  ];
  const params: unknown[] = [...appIds];

  if (options.workItemIds && options.workItemIds.length > 0) {
    conditions.push(`snapshot.work_item_id IN (${placeholders(options.workItemIds.length)})`);
    params.push(...options.workItemIds);
  }
  const rangeStart = options.rangeStart || (options.rangeDays && options.rangeDays > 0 ? isoDaysAgo(options.rangeDays) : null);
  const rangeEnd = options.rangeEnd || null;
  if (rangeStart) {
    conditions.push("datetime(wi.updated_at) >= datetime(?)");
    params.push(rangeStart);
  }
  if (rangeEnd) {
    conditions.push("datetime(wi.updated_at) <= datetime(?)");
    params.push(rangeEnd);
  }

  const limit = options.maxItems && options.maxItems > 0
    ? Math.floor(options.maxItems)
    : null;
  if (limit !== null) {
    params.push(limit);
  }

  return getDb().prepare(`
    SELECT
      snapshot.*,
      app.name AS app_name,
      wi.title AS work_item_title,
      wi.status AS work_item_status,
      pr.owner AS owner,
      pr.repo AS repo,
      pr.pr_number AS pr_number,
      pr.pr_url AS pr_url,
      pr.title AS pr_title,
      pr.state AS pr_state,
      pr.author_login AS pr_author_login
    FROM llm_outcome_snapshots snapshot
    JOIN work_items wi ON wi.id = snapshot.work_item_id
    JOIN apps app ON app.id = snapshot.app_id
    JOIN github_pr_snapshots pr ON pr.id = snapshot.pr_snapshot_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY snapshot.computed_at DESC, snapshot.id DESC
    ${limit !== null ? "LIMIT ?" : ""}
  `).all(...params) as AssessmentCandidate[];
}

function loadPacket(candidate: AssessmentCandidate): OutcomeAssessmentPacket {
  const prSnapshotId = candidate.pr_snapshot_id!;
  const comments = getDb().prepare(`
    SELECT * FROM github_pr_comments
    WHERE pr_snapshot_id = ?
    ORDER BY github_created_at ASC, id ASC
    LIMIT 80
  `).all(prSnapshotId) as GitHubPrCommentRow[];
  const reviews = getDb().prepare(`
    SELECT * FROM github_pr_reviews
    WHERE pr_snapshot_id = ?
    ORDER BY submitted_at ASC, id ASC
    LIMIT 40
  `).all(prSnapshotId) as GitHubPrReviewRow[];
  const commits = getDb().prepare(`
    SELECT * FROM github_pr_commits
    WHERE pr_snapshot_id = ?
    ORDER BY authored_at ASC, committed_at ASC, id ASC
    LIMIT 80
  `).all(prSnapshotId) as GitHubPrCommitRow[];

  return {
    app: { id: candidate.app_id, name: candidate.app_name },
    work_item: {
      id: candidate.work_item_id,
      title: candidate.work_item_title,
      status: candidate.work_item_status,
    },
    snapshot: {
      id: candidate.id,
      outcome_state: candidate.outcome_state,
      quality_band: candidate.quality_band,
      correction_burden_score: candidate.correction_burden_score,
      issue_comment_count: candidate.issue_comment_count,
      review_comment_count: candidate.review_comment_count,
      human_after_agent_commit_count: candidate.human_after_agent_commit_count,
    },
    pull_request: {
      snapshot_id: prSnapshotId,
      owner: candidate.owner,
      repo: candidate.repo,
      number: candidate.pr_number,
      url: candidate.pr_url,
      title: candidate.pr_title,
      state: candidate.pr_state,
      author_login: candidate.pr_author_login,
    },
    comments: comments.map((comment) => ({
      id: `${comment.comment_type}-${comment.github_id}`,
      type: comment.comment_type,
      author_login: comment.author_login,
      body: truncate(comment.body, 1200),
      path: comment.path,
      created_at: comment.github_created_at,
    })),
    reviews: reviews.map((review) => ({
      id: `review-${review.github_id}`,
      author_login: review.author_login,
      state: review.state,
      body: truncate(review.body, 1200),
      submitted_at: review.submitted_at,
    })),
    commits: commits.map((commit) => ({
      id: `commit-${commit.sha}`,
      sha: commit.sha,
      author_login: commit.author_login,
      committer_login: commit.committer_login,
      message: truncate(commit.message, 500),
      authored_at: commit.authored_at,
      committed_at: commit.committed_at,
    })),
  };
}

function shouldSkipExisting(candidate: AssessmentCandidate, inputHash: string, force: boolean): boolean {
  if (force) return false;
  const latest = dal.getLatestLlmOutcomeAssessmentForWorkItem(candidate.work_item_id);
  return latest?.status === "completed" && latest.input_hash === inputHash;
}

function createFailedAssessment(candidate: AssessmentCandidate, model: { provider: string; model: string }, inputHash: string, error: unknown): LlmOutcomeAssessmentRow {
  return dal.createLlmOutcomeAssessment({
    app_id: candidate.app_id,
    work_item_id: candidate.work_item_id,
    snapshot_id: candidate.id,
    pr_snapshot_id: candidate.pr_snapshot_id,
    provider_id: model.provider,
    model_id: model.model,
    input_hash: inputHash,
    status: "failed",
    confidence: "unknown",
    error_text: error instanceof Error ? error.message : "Outcome evidence assessment failed",
  });
}

export async function runOutcomeEvidenceAssessment(
  options: RunOutcomeEvidenceAssessmentOptions,
): Promise<RunOutcomeEvidenceAssessmentResult> {
  const generatedAt = new Date().toISOString();
  const warnings: string[] = [];
  if (options.apps.length === 0) {
    return {
      assessed_count: 0,
      skipped_count: 0,
      failed_count: 0,
      assessment_ids: [],
      recomputed_snapshots: 0,
      generated_at: generatedAt,
      warnings,
    };
  }

  recomputeOutcomeSnapshots({
    apps: options.apps,
    workItemIds: options.workItemIds,
    rangeDays: options.rangeStart ? null : options.rangeDays,
    rangeStart: options.rangeStart,
    rangeEnd: options.rangeEnd,
  });

  const candidates = loadCandidates(options.apps, options);
  if (candidates.length === 0) {
    warnings.push("No GitHub-enriched outcome snapshots were available for assessment.");
  }

  const assessor = options.assessor || defaultAssess;
  const model = getModelForCategory("quick");
  let assessedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const assessmentIds: number[] = [];
  const assessedWorkItemIds: number[] = [];

  for (const candidate of candidates) {
    const packet = loadPacket(candidate);
    const inputHash = hashPacket(packet);
    if (shouldSkipExisting(candidate, inputHash, Boolean(options.force))) {
      skippedCount += 1;
      continue;
    }

    try {
      const assessment = normalizeOutcomeEvidenceAssessment(await assessor(packet));
      const row = dal.createLlmOutcomeAssessment({
        app_id: candidate.app_id,
        work_item_id: candidate.work_item_id,
        snapshot_id: candidate.id,
        pr_snapshot_id: candidate.pr_snapshot_id,
        provider_id: model.provider,
        model_id: model.model,
        input_hash: inputHash,
        status: "completed",
        assessment_json: JSON.stringify(assessment),
        confidence: assessment.confidence,
      });
      assessedCount += 1;
      assessmentIds.push(row.id);
      assessedWorkItemIds.push(candidate.work_item_id);
    } catch (error) {
      const row = createFailedAssessment(candidate, model, inputHash, error);
      failedCount += 1;
      assessmentIds.push(row.id);
      assessedWorkItemIds.push(candidate.work_item_id);
      warnings.push(`Assessment failed for work item ${candidate.work_item_id}.`);
    }
  }

  const recomputed = assessedWorkItemIds.length > 0
    ? recomputeOutcomeSnapshots({
      apps: options.apps,
      workItemIds: Array.from(new Set(assessedWorkItemIds)),
    }).recomputed_count
    : 0;

  return {
    assessed_count: assessedCount,
    skipped_count: skippedCount,
    failed_count: failedCount,
    assessment_ids: assessmentIds,
    recomputed_snapshots: recomputed,
    generated_at: generatedAt,
    warnings,
  };
}
