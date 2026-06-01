import * as dal from "@/lib/server/dal";
import { getDb } from "@/lib/server/db";
import { getGitHubAppSettings } from "@/lib/server/github-app";
import { applyOutcomeEvidenceAssessment, parseOutcomeEvidenceAssessment } from "@/lib/server/outcome-assessment-rules";
import { parsePullRequestMetadata } from "@/lib/server/github-pr-utils";
import type {
  AppRow,
  GitHubPrCommentRow,
  GitHubPrCommitRow,
  GitHubPrReviewRow,
  LlmAttributionClassification,
  LlmAttributionConfidence,
  LlmOutcomeConfidence,
  LlmOutcomeQualityBand,
  LlmOutcomeSnapshotRow,
  LlmOutcomeState,
  RunRow,
} from "@/lib/server/types";

type SnapshotCandidate = {
  app_id: number;
  work_item_id: number;
  conversation_id: number | null;
  session_id: number | null;
  pr_artifact_id: number | null;
  pr_metadata_json: string | null;
  pr_snapshot_id: number | null;
  evidence_state: string | null;
  evidence_issue_comments_count: number | null;
  evidence_review_comments_count: number | null;
  evidence_reviews_count: number | null;
  evidence_commits_count: number | null;
  evidence_author_login: string | null;
  work_item_updated_at: string;
};

type MatchedRun = RunRow & { matched_work_item_id: number };
type CommitClassification = "agent_authored" | "agent_coauthored" | "human_authored" | "unknown";

export interface RecomputeOutcomeSnapshotsOptions {
  apps: AppRow[];
  workItemIds?: number[];
  rangeStart?: string | null;
  rangeEnd?: string | null;
  rangeDays?: number | null;
  computedAt?: string;
}

export interface RecomputeOutcomeSnapshotsResult {
  recomputed_count: number;
  snapshots: LlmOutcomeSnapshotRow[];
  generated_at: string;
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

function parseCost(resultJson: string | null): number | null {
  if (!resultJson) return null;
  try {
    const parsed = JSON.parse(resultJson);
    const value = parsed?.cost;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function summarizeRuns(runs: MatchedRun[]): { knownCost: number | null; unknownCostRuns: number } {
  let knownCost = 0;
  let hasKnownCost = false;
  let unknownCostRuns = 0;

  for (const run of runs) {
    const cost = parseCost(run.result_json);
    if (cost === null) {
      unknownCostRuns += 1;
    } else {
      hasKnownCost = true;
      knownCost += cost;
    }
  }

  return { knownCost: hasKnownCost ? knownCost : null, unknownCostRuns };
}

function outcomeFromPrState(state: string | null): LlmOutcomeState {
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed_unmerged";
  if (state === "OPEN") return "pending_pr";
  return "unknown";
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function normalize(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function parseCoAuthors(message: string): Array<{ name: string; email: string }> {
  const results: Array<{ name: string; email: string }> = [];
  const pattern = /^co-authored-by:\s*(.*?)\s*<([^>]+)>/gim;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message))) {
    results.push({ name: match[1]?.trim() || "", email: match[2]?.trim() || "" });
  }
  return results;
}

function matchesAny(value: string | null | undefined, values: Set<string>): boolean {
  const normalized = normalize(value);
  return Boolean(normalized && values.has(normalized));
}

function getActorSignals() {
  const settings = getGitHubAppSettings();
  const botLogin = normalize(settings.bot_username);
  const botName = normalize(settings.bot_display_name);
  const botEmail = normalize(settings.bot_email);
  const botLogins = new Set<string>();
  const botNames = new Set<string>();
  const botEmails = new Set<string>();

  if (botLogin) {
    botLogins.add(botLogin);
    botLogins.add(`${botLogin}[bot]`);
    botLogins.add(botLogin.replace(/\[bot\]$/, ""));
  }
  if (botName) botNames.add(botName);
  if (botEmail) botEmails.add(botEmail);

  const users = getDb().prepare(
    "SELECT github_login, github_email FROM github_user_connections WHERE revoked_at IS NULL"
  ).all() as Array<{ github_login: string | null; github_email: string | null }>;
  const humanLogins = new Set<string>();
  const humanEmails = new Set<string>();
  for (const user of users) {
    const login = normalize(user.github_login);
    const email = normalize(user.github_email);
    if (login) humanLogins.add(login);
    if (email) humanEmails.add(email);
  }

  return { botLogins, botNames, botEmails, humanLogins, humanEmails };
}

function coAuthorMatchesBot(coAuthor: { name: string; email: string }, actors: ReturnType<typeof getActorSignals>): boolean {
  return matchesAny(coAuthor.email, actors.botEmails) || matchesAny(coAuthor.name, actors.botNames);
}

function classifyPrAuthor(
  authorLogin: string | null,
  actors: ReturnType<typeof getActorSignals>,
  hasValidPrArtifact: boolean,
): {
  classification: LlmAttributionClassification;
  confidence: LlmAttributionConfidence;
  reason: string;
} {
  if (matchesAny(authorLogin, actors.botLogins)) {
    return {
      classification: "agent",
      confidence: "high",
      reason: "PR author login matches the configured Archie GitHub bot.",
    };
  }
  if (matchesAny(authorLogin, actors.humanLogins)) {
    return {
      classification: "known_user",
      confidence: "high",
      reason: "PR author login matches a connected Archie user.",
    };
  }
  if (normalize(authorLogin)) {
    return {
      classification: "human",
      confidence: "medium",
      reason: "PR author login is present, but it is not mapped to a connected Archie user.",
    };
  }
  if (hasValidPrArtifact) {
    return {
      classification: "unknown",
      confidence: "low",
      reason: "A local PR artifact exists, but the GitHub PR author has not been synced.",
    };
  }
  return {
    classification: "unknown",
    confidence: "unknown",
    reason: "No PR author evidence is available.",
  };
}

function classifyCommit(commit: GitHubPrCommitRow, actors: ReturnType<typeof getActorSignals>): {
  classification: CommitClassification;
  signals: string[];
} {
  const coAuthors = parseCoAuthors(commit.message || "");
  const hasAgentAuthor =
    matchesAny(commit.author_login, actors.botLogins) ||
    matchesAny(commit.committer_login, actors.botLogins) ||
    matchesAny(commit.author_email, actors.botEmails) ||
    matchesAny(commit.author_name, actors.botNames);
  const hasAgentCoAuthor = coAuthors.some((coAuthor) => coAuthorMatchesBot(coAuthor, actors));
  const hasHumanAuthor =
    Boolean(normalize(commit.author_login) || normalize(commit.author_email) || normalize(commit.author_name)) &&
    !matchesAny(commit.author_login, actors.botLogins) &&
    !matchesAny(commit.author_email, actors.botEmails) &&
    !matchesAny(commit.author_name, actors.botNames);
  const hasKnownHuman =
    matchesAny(commit.author_login, actors.humanLogins) ||
    matchesAny(commit.author_email, actors.humanEmails);
  const hasHumanCoAuthor = coAuthors.some((coAuthor) => !coAuthorMatchesBot(coAuthor, actors));
  const signals: string[] = [];
  if (hasAgentAuthor) signals.push("agent_author_or_committer");
  if (hasAgentCoAuthor) signals.push("agent_coauthor_trailer");
  if (hasKnownHuman) signals.push("known_human_author");
  if (hasHumanCoAuthor) signals.push("human_coauthor_trailer");

  if ((hasAgentAuthor && (hasHumanAuthor || hasHumanCoAuthor)) || hasAgentCoAuthor) {
    return { classification: "agent_coauthored", signals };
  }
  if (hasAgentAuthor) return { classification: "agent_authored", signals };
  if (hasHumanAuthor || hasHumanCoAuthor) return { classification: "human_authored", signals };
  return { classification: "unknown", signals };
}

function groupRunsByWorkItem(workItemIds: number[]): Map<number, MatchedRun[]> {
  const grouped = new Map<number, MatchedRun[]>();
  if (workItemIds.length === 0) return grouped;

  const rows = getDb().prepare(`
    SELECT r.*, wi.id AS matched_work_item_id
    FROM runs r
    JOIN work_items wi
      ON r.work_item_id = wi.id
      OR (r.work_item_id IS NULL AND r.conversation_id = wi.primary_conversation_id)
    WHERE wi.id IN (${placeholders(workItemIds.length)})
    ORDER BY r.id ASC
  `).all(...workItemIds) as MatchedRun[];

  for (const run of rows) {
    const list = grouped.get(run.matched_work_item_id) || [];
    list.push(run);
    grouped.set(run.matched_work_item_id, list);
  }
  return grouped;
}

function groupBySnapshotId<T extends { pr_snapshot_id: number }>(rows: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.pr_snapshot_id) || [];
    list.push(row);
    grouped.set(row.pr_snapshot_id, list);
  }
  return grouped;
}

function computeCommitAttribution(commits: GitHubPrCommitRow[], actors: ReturnType<typeof getActorSignals>) {
  let humanCommitCount = 0;
  let agentCommitCount = 0;
  let coauthoredCommitCount = 0;
  let unknownCommitCount = 0;
  let humanAfterAgentCommitCount = 0;
  let seenAgentAssistedCommit = false;
  let hasAgentAuthorSignal = false;
  let hasAgentCoauthorSignal = false;
  let hasKnownHumanSignal = false;
  let hasHumanSignal = false;

  const classifications = commits
    .slice()
    .sort((a, b) => {
      const left = Date.parse(a.authored_at || a.committed_at || "");
      const right = Date.parse(b.authored_at || b.committed_at || "");
      return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
    })
    .map((commit) => {
      const classified = classifyCommit(commit, actors);
      if (classified.classification === "human_authored") humanCommitCount += 1;
      if (classified.classification === "agent_authored") agentCommitCount += 1;
      if (classified.classification === "agent_coauthored") coauthoredCommitCount += 1;
      if (classified.classification === "unknown") unknownCommitCount += 1;
      if (classified.signals.includes("agent_author_or_committer")) hasAgentAuthorSignal = true;
      if (classified.signals.includes("agent_coauthor_trailer")) hasAgentCoauthorSignal = true;
      if (classified.signals.includes("known_human_author")) hasKnownHumanSignal = true;
      if (classified.classification === "human_authored") hasHumanSignal = true;
      if (seenAgentAssistedCommit && classified.classification === "human_authored") {
        humanAfterAgentCommitCount += 1;
      }
      if (classified.classification === "agent_authored" || classified.classification === "agent_coauthored") {
        seenAgentAssistedCommit = true;
      }
      return {
        sha: commit.sha,
        classification: classified.classification,
        signals: classified.signals,
        author_login: commit.author_login,
        author_email: commit.author_email,
        committer_login: commit.committer_login,
        authored_at: commit.authored_at,
      };
    });

  return {
    humanCommitCount,
    agentCommitCount,
    coauthoredCommitCount,
    unknownCommitCount,
    humanAfterAgentCommitCount,
    hasAgentAuthorSignal,
    hasAgentCoauthorSignal,
    hasKnownHumanSignal,
    hasHumanSignal,
    classifications,
  };
}

function computeAttributionConfidence(input: {
  hasValidPrArtifact: boolean;
  prAuthorConfidence: LlmAttributionConfidence;
  hasAgentAuthorSignal: boolean;
  hasAgentCoauthorSignal: boolean;
  hasKnownHumanSignal: boolean;
  hasHumanSignal: boolean;
  commitCount: number;
}): { confidence: LlmAttributionConfidence; reason: string } {
  if (input.hasAgentAuthorSignal || input.prAuthorConfidence === "high" || input.hasKnownHumanSignal) {
    return {
      confidence: "high",
      reason: "Attribution is backed by a bot or connected-user GitHub login/email signal.",
    };
  }
  if (input.hasAgentCoauthorSignal) {
    return {
      confidence: "medium",
      reason: "Attribution is backed by an Archie co-author trailer.",
    };
  }
  if (input.prAuthorConfidence === "medium" || input.hasHumanSignal) {
    return {
      confidence: "medium",
      reason: "Attribution is backed by GitHub user evidence that is not mapped to a connected Archie user.",
    };
  }
  if (input.hasValidPrArtifact || input.commitCount > 0) {
    return {
      confidence: "low",
      reason: "Attribution is inferred from incomplete local or commit evidence.",
    };
  }
  return {
    confidence: "unknown",
    reason: "No reliable attribution evidence is available.",
  };
}

function computeQuality(input: {
  outcomeState: LlmOutcomeState;
  hasGitHubEvidence: boolean;
  hasValidPrArtifact: boolean;
  issueCommentCount: number;
  reviewCommentCount: number;
  reviewCount: number;
  changesRequestedCount: number;
  humanAfterAgentCommitCount: number;
}): {
  qualityBand: LlmOutcomeQualityBand;
  confidence: LlmOutcomeConfidence;
  correctionBurdenScore: number;
  reason: string;
} {
  const correctionBurdenScore =
    input.reviewCommentCount +
    input.changesRequestedCount * 2 +
    input.humanAfterAgentCommitCount * 3 +
    Math.max(0, input.issueCommentCount - 1);

  if (!input.hasValidPrArtifact) {
    return {
      qualityBand: "unknown",
      confidence: "low",
      correctionBurdenScore,
      reason: "No pull request artifact exists for this work item.",
    };
  }

  if (!input.hasGitHubEvidence) {
    return {
      qualityBand: "pending",
      confidence: "low",
      correctionBurdenScore,
      reason: "A local pull request artifact exists, but GitHub evidence has not been synced.",
    };
  }

  if (input.outcomeState === "pending_pr") {
    return {
      qualityBand: "pending",
      confidence: "high",
      correctionBurdenScore,
      reason: "The pull request is still open, so outcome learning is not final.",
    };
  }

  if (input.outcomeState === "closed_unmerged") {
    return {
      qualityBand: "abandoned",
      confidence: "high",
      correctionBurdenScore,
      reason: "The pull request was closed without merge.",
    };
  }

  if (input.outcomeState === "merged") {
    if (input.reviewCommentCount >= 5 || input.humanAfterAgentCommitCount >= 2 || correctionBurdenScore >= 7) {
      return {
        qualityBand: "costly_reworked",
        confidence: "high",
        correctionBurdenScore,
        reason: "The pull request merged, but review or post-agent human commits indicate meaningful rework.",
      };
    }
    if (input.reviewCommentCount <= 1 && input.issueCommentCount <= 1 && input.humanAfterAgentCommitCount === 0 && input.changesRequestedCount === 0) {
      return {
        qualityBand: "strong",
        confidence: "high",
        correctionBurdenScore,
        reason: "The pull request merged with low review pressure and no detected human correction commits after agent work.",
      };
    }
    return {
      qualityBand: "useful",
      confidence: "high",
      correctionBurdenScore,
      reason: "The pull request merged with moderate review or follow-up evidence.",
    };
  }

  return {
    qualityBand: "unknown",
    confidence: "medium",
    correctionBurdenScore,
    reason: "GitHub evidence exists but the pull request state could not be classified.",
  };
}

function loadCandidates(apps: AppRow[], options: Pick<RecomputeOutcomeSnapshotsOptions, "workItemIds" | "rangeStart" | "rangeEnd" | "rangeDays">): SnapshotCandidate[] {
  if (apps.length === 0) return [];
  const appIds = apps.map((app) => app.id);
  const conditions = [`wi.app_id IN (${placeholders(appIds.length)})`];
  const params: unknown[] = [...appIds];
  if (options.workItemIds && options.workItemIds.length > 0) {
    conditions.push(`wi.id IN (${placeholders(options.workItemIds.length)})`);
    params.push(...options.workItemIds);
  }
  const rangeEnd = options.rangeEnd || null;
  const rangeStart = options.rangeStart || (options.rangeDays && options.rangeDays > 0 ? isoDaysAgo(options.rangeDays) : null);
  if (rangeStart) {
    conditions.push("datetime(wi.updated_at) >= datetime(?)");
    params.push(rangeStart);
  }
  if (rangeEnd) {
    conditions.push("datetime(wi.updated_at) <= datetime(?)");
    params.push(rangeEnd);
  }

  return getDb().prepare(`
    SELECT
      wi.app_id AS app_id,
      wi.id AS work_item_id,
      wi.updated_at AS work_item_updated_at,
      wi.primary_conversation_id AS conversation_id,
      latest_session.id AS session_id,
      pr.id AS pr_artifact_id,
      pr.metadata_json AS pr_metadata_json,
      evidence.id AS pr_snapshot_id,
      evidence.state AS evidence_state,
      evidence.issue_comments_count AS evidence_issue_comments_count,
      evidence.review_comments_count AS evidence_review_comments_count,
      evidence.reviews_count AS evidence_reviews_count,
      evidence.commits_count AS evidence_commits_count,
      evidence.author_login AS evidence_author_login
    FROM work_items wi
    LEFT JOIN agent_sessions latest_session ON latest_session.id = (
      SELECT id FROM agent_sessions
      WHERE conversation_id = wi.primary_conversation_id
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    )
    LEFT JOIN artifacts pr ON pr.id = (
      SELECT id FROM artifacts
      WHERE work_item_id = wi.id AND kind = 'pull_request'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    LEFT JOIN github_pr_snapshots evidence ON evidence.id = (
      SELECT id FROM github_pr_snapshots
      WHERE work_item_id = wi.id
      ORDER BY synced_at DESC, id DESC
      LIMIT 1
    )
    WHERE ${conditions.join(" AND ")}
    ORDER BY wi.updated_at DESC, wi.id DESC
  `).all(...params) as SnapshotCandidate[];
}

export function recomputeOutcomeSnapshots(options: RecomputeOutcomeSnapshotsOptions): RecomputeOutcomeSnapshotsResult {
  const candidates = loadCandidates(options.apps, options);
  if (candidates.length === 0) {
    return { recomputed_count: 0, snapshots: [], generated_at: new Date().toISOString() };
  }

  const workItemIds = candidates.map((candidate) => candidate.work_item_id);
  const snapshotIds = candidates
    .map((candidate) => candidate.pr_snapshot_id)
    .filter((id): id is number => typeof id === "number");
  const runsByWorkItem = groupRunsByWorkItem(workItemIds);
  const assessmentsByWorkItem = new Map(
    dal.listLatestLlmOutcomeAssessmentsForWorkItems(workItemIds).map((assessment) => [assessment.work_item_id, assessment]),
  );
  const actors = getActorSignals();

  const commentsBySnapshot = snapshotIds.length
    ? groupBySnapshotId(getDb().prepare(
      `SELECT * FROM github_pr_comments WHERE pr_snapshot_id IN (${placeholders(snapshotIds.length)})`
    ).all(...snapshotIds) as GitHubPrCommentRow[])
    : new Map<number, GitHubPrCommentRow[]>();
  const reviewsBySnapshot = snapshotIds.length
    ? groupBySnapshotId(getDb().prepare(
      `SELECT * FROM github_pr_reviews WHERE pr_snapshot_id IN (${placeholders(snapshotIds.length)})`
    ).all(...snapshotIds) as GitHubPrReviewRow[])
    : new Map<number, GitHubPrReviewRow[]>();
  const commitsBySnapshot = snapshotIds.length
    ? groupBySnapshotId(getDb().prepare(
      `SELECT * FROM github_pr_commits WHERE pr_snapshot_id IN (${placeholders(snapshotIds.length)})`
    ).all(...snapshotIds) as GitHubPrCommitRow[])
    : new Map<number, GitHubPrCommitRow[]>();

  const computedAt = options.computedAt || new Date().toISOString();
  const snapshots: LlmOutcomeSnapshotRow[] = [];

  for (const candidate of candidates) {
    const pr = parsePullRequestMetadata(candidate.pr_metadata_json);
    const hasPrArtifact = candidate.pr_artifact_id !== null;
    const hasValidPrArtifact = hasPrArtifact && pr.prNumber !== null;
    const hasGitHubEvidence = candidate.pr_snapshot_id !== null;
    const runs = runsByWorkItem.get(candidate.work_item_id) || [];
    const cost = summarizeRuns(runs);
    const comments = candidate.pr_snapshot_id ? commentsBySnapshot.get(candidate.pr_snapshot_id) || [] : [];
    const reviews = candidate.pr_snapshot_id ? reviewsBySnapshot.get(candidate.pr_snapshot_id) || [] : [];
    const commits = candidate.pr_snapshot_id ? commitsBySnapshot.get(candidate.pr_snapshot_id) || [] : [];
    const issueCommentCount = comments.filter((comment) => comment.comment_type === "issue").length || candidate.evidence_issue_comments_count || 0;
    const reviewCommentCount = comments.filter((comment) => comment.comment_type === "review").length || candidate.evidence_review_comments_count || 0;
    const reviewCount = reviews.length || candidate.evidence_reviews_count || 0;
    const commitCount = commits.length || candidate.evidence_commits_count || 0;
    const changesRequestedCount = reviews.filter((review) => normalize(review.state) === "changes_requested").length;
    const attribution = computeCommitAttribution(commits, actors);
    const prAuthor = classifyPrAuthor(candidate.evidence_author_login, actors, hasValidPrArtifact);
    const outcomeState = hasGitHubEvidence
      ? outcomeFromPrState(candidate.evidence_state === "MERGED" || candidate.evidence_state === "CLOSED" || candidate.evidence_state === "OPEN" ? candidate.evidence_state : null)
      : hasValidPrArtifact
        ? "pending_pr"
        : hasPrArtifact
          ? "unknown"
          : "no_pr";
    const quality = computeQuality({
      outcomeState,
      hasGitHubEvidence,
      hasValidPrArtifact,
      issueCommentCount,
      reviewCommentCount,
      reviewCount,
      changesRequestedCount,
      humanAfterAgentCommitCount: attribution.humanAfterAgentCommitCount,
    });
    const assessmentRow = assessmentsByWorkItem.get(candidate.work_item_id) || null;
    const assessment = assessmentRow?.status === "completed"
      ? parseOutcomeEvidenceAssessment(assessmentRow.assessment_json)
      : null;
    const appliedQuality = applyOutcomeEvidenceAssessment({
      outcomeState,
      deterministic: quality,
      assessment,
    });
    const attributionConfidence = computeAttributionConfidence({
      hasValidPrArtifact,
      prAuthorConfidence: prAuthor.confidence,
      hasAgentAuthorSignal: attribution.hasAgentAuthorSignal,
      hasAgentCoauthorSignal: attribution.hasAgentCoauthorSignal,
      hasKnownHumanSignal: attribution.hasKnownHumanSignal,
      hasHumanSignal: attribution.hasHumanSignal,
      commitCount,
    });

    const snapshot = dal.upsertLlmOutcomeSnapshot({
      app_id: candidate.app_id,
      work_item_id: candidate.work_item_id,
      conversation_id: candidate.conversation_id,
      session_id: candidate.session_id,
      pr_snapshot_id: candidate.pr_snapshot_id,
      assessment_id: assessmentRow?.id ?? null,
      pr_author_login: candidate.evidence_author_login,
      pr_author_classification: prAuthor.classification,
      pr_author_confidence: prAuthor.confidence,
      attribution_confidence: attributionConfidence.confidence,
      outcome_state: outcomeState,
      quality_band: appliedQuality.qualityBand,
      confidence: appliedQuality.confidence,
      known_cost_usd: cost.knownCost,
      unknown_cost_runs: cost.unknownCostRuns,
      issue_comment_count: issueCommentCount,
      review_comment_count: reviewCommentCount,
      review_count: reviewCount,
      commit_count: commitCount,
      human_commit_count: attribution.humanCommitCount,
      agent_commit_count: attribution.agentCommitCount,
      coauthored_commit_count: attribution.coauthoredCommitCount,
      unknown_commit_count: attribution.unknownCommitCount,
      human_after_agent_commit_count: attribution.humanAfterAgentCommitCount,
      correction_burden_score: appliedQuality.correctionBurdenScore,
      evidence_json: JSON.stringify({
        rules_version: 2,
        quality_reason: appliedQuality.reason,
        deterministic_quality_band: appliedQuality.deterministicQualityBand,
        deterministic_quality_reason: appliedQuality.deterministicQualityReason,
        assessment_quality_reason: appliedQuality.assessmentQualityReason,
        llm_assessment: assessment,
        attribution_reason: attributionConfidence.reason,
        changes_requested_count: changesRequestedCount,
        correction_burden_inputs: {
          review_comment_count: reviewCommentCount,
          changes_requested_count: changesRequestedCount,
          human_after_agent_commit_count: attribution.humanAfterAgentCommitCount,
          extra_issue_comment_count: Math.max(0, issueCommentCount - 1),
        },
        pr_author: {
          login: candidate.evidence_author_login,
          classification: prAuthor.classification,
          confidence: prAuthor.confidence,
          reason: prAuthor.reason,
        },
        pr_artifact_warnings: pr.warnings,
        commit_classifications: attribution.classifications,
      }),
      computed_at: computedAt,
    });
    snapshots.push(snapshot);
  }

  return { recomputed_count: snapshots.length, snapshots, generated_at: computedAt };
}
