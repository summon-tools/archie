import { getDb } from "@/lib/server/db";
import { getPullRequest } from "@/lib/server/github";
import { normalizeOutcomeEvidenceAssessment, parseOutcomeEvidenceAssessment } from "@/lib/server/outcome-assessment-rules";
import { parsePullRequestMetadata, resolvePullRequestRepo } from "@/lib/server/github-pr-utils";
import type { AppRow, RunRow } from "@/lib/server/types";
import type {
  OutcomeCoverageCounts,
  OutcomeCostBuckets,
  OutcomeEvidenceCompleteness,
  OutcomeRow,
  OutcomeRowGroup,
  OutcomesSummaryResponse,
  OutcomeState,
} from "@/lib/types";

const OUTCOME_GROUP_ORDER: OutcomeState[] = ["pending_pr", "merged", "closed_unmerged", "no_pr", "unknown"];

type PullRequestLookup = (params: {
  owner: string;
  repo: string;
  pr_number: number;
  token: string;
}) => Promise<{ state: string; pr_url: string; pr_number: number; title: string } | null>;

interface BuildOutcomesOptions {
  apps: AppRow[];
  githubToken?: string | null;
  githubUnavailableWarning?: string;
  maxGithubLookups?: number | null;
  refreshGitHubState?: boolean;
  rowFilters?: OutcomeRowFilters;
  pagination?: OutcomePaginationOptions;
  groupPagination?: OutcomeGroupPaginationOptions;
  prLookup?: PullRequestLookup;
}

export interface OutcomeRowFilters {
  appId?: number | null;
  outcomeState?: OutcomeState | null;
  providerId?: string | null;
  modelId?: string | null;
  runStatus?: string | null;
  prState?: string | null;
}

export interface OutcomePaginationOptions {
  page?: number;
  pageSize?: number;
}

export interface OutcomeGroupPaginationOptions {
  pageSize?: number;
  pagesByState?: Partial<Record<OutcomeState, number>>;
}

type OutcomeRecord = {
  app_id: number;
  app_name: string;
  app_github_repo: string | null;
  work_item_id: number;
  work_item_title: string;
  work_item_status: string;
  conversation_id: number | null;
  conversation_title: string | null;
  branch_name: string | null;
  session_id: number | null;
  session_provider_id: string | null;
  external_session_id: string | null;
  session_status: string | null;
  last_model_id: string | null;
  work_item_created_at: string;
  work_item_updated_at: string;
  pr_artifact_id: number | null;
  pr_metadata_json: string | null;
  evidence_synced_at: string | null;
  evidence_state: string | null;
  evidence_pr_url: string | null;
  evidence_title: string | null;
  evidence_merged_at: string | null;
  evidence_closed_at: string | null;
  evidence_issue_comments_count: number | null;
  evidence_review_comments_count: number | null;
  evidence_reviews_count: number | null;
  evidence_commits_count: number | null;
  evidence_additions: number | null;
  evidence_deletions: number | null;
  evidence_changed_files: number | null;
  snapshot_id: number | null;
  snapshot_assessment_id: number | null;
  snapshot_outcome_state: string | null;
  snapshot_quality_band: string | null;
  snapshot_confidence: string | null;
  snapshot_pr_author_login: string | null;
  snapshot_pr_author_classification: string | null;
  snapshot_pr_author_confidence: string | null;
  snapshot_attribution_confidence: string | null;
  snapshot_computed_at: string | null;
  snapshot_evidence_json: string | null;
  snapshot_correction_burden_score: number | null;
  snapshot_human_commit_count: number | null;
  snapshot_agent_commit_count: number | null;
  snapshot_coauthored_commit_count: number | null;
  snapshot_unknown_commit_count: number | null;
  snapshot_human_after_agent_commit_count: number | null;
  assessment_id: number | null;
  assessment_status: string | null;
  assessment_confidence: string | null;
  assessment_provider_id: string | null;
  assessment_model_id: string | null;
  assessment_json: string | null;
  assessment_created_at: string | null;
};

type MatchedRun = RunRow & { matched_work_item_id: number };
type FollowupRecord = {
  id: number;
  source_work_item_id: number;
  relation_type: string;
  confidence: string;
  deterministic_score: number;
  deterministic_signals_json: string | null;
  assessment_json: string | null;
  detected_at: string;
  followup_pr_number: number;
  followup_pr_url: string | null;
  followup_title: string | null;
};

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

function pushUnique(target: string[], message: string): void {
  if (!target.includes(message)) target.push(message);
}

function emptySummary(apps: AppRow[], warnings: string[] = []): OutcomesSummaryResponse {
  return {
    generated_at: new Date().toISOString(),
    counts: {
      total_work_items: 0,
      total_sessions: 0,
      pr_linked_work: 0,
      pending_prs: 0,
      merged_prs: 0,
      closed_unmerged_prs: 0,
      no_pr_work: 0,
      unknown_outcome: 0,
      rows_with_unknown_cost: 0,
      unknown_cost_runs: 0,
    },
    costs: {
      total_known_cost_usd: 0,
      pending_pr_cost_usd: 0,
      merged_pr_cost_usd: 0,
      closed_unmerged_cost_usd: 0,
      no_pr_cost_usd: 0,
      unknown_outcome_cost_usd: 0,
    },
    coverage: emptyCoverage(),
    rows: [],
    row_groups: OUTCOME_GROUP_ORDER.map((state) => ({
      state,
      rows: [],
      pagination: {
        page: 1,
        page_size: 25,
        total_rows: 0,
        filtered_rows: 0,
        page_count: 0,
        has_previous: false,
        has_next: false,
      },
    })),
    pagination: {
      page: 1,
      page_size: 25,
      total_rows: 0,
      filtered_rows: 0,
      page_count: 0,
      has_previous: false,
      has_next: false,
    },
    filters: {
      apps: apps.map((app) => ({ id: app.id, name: app.name })),
      providers: [],
      models: [],
      run_statuses: [],
      outcome_states: [],
      pr_states: [],
    },
    warnings,
  };
}

function emptyCoverage(): OutcomeCoverageCounts {
  return {
    github_evidence_synced_rows: 0,
    computed_snapshot_rows: 0,
    assessed_evidence_rows: 0,
    followup_rows: 0,
    regression_followup_rows: 0,
    quality_counts: {},
  };
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

function groupFollowupsByWorkItem(workItemIds: number[]): Map<number, FollowupRecord[]> {
  const grouped = new Map<number, FollowupRecord[]>();
  if (workItemIds.length === 0) return grouped;
  const rows = getDb().prepare(`
    SELECT
      followup.id AS id,
      followup.source_work_item_id AS source_work_item_id,
      followup.relation_type AS relation_type,
      followup.confidence AS confidence,
      followup.deterministic_score AS deterministic_score,
      followup.deterministic_signals_json AS deterministic_signals_json,
      followup.assessment_json AS assessment_json,
      followup.detected_at AS detected_at,
      repo_pr.pr_number AS followup_pr_number,
      repo_pr.pr_url AS followup_pr_url,
      repo_pr.title AS followup_title
    FROM llm_outcome_followups followup
    JOIN github_repo_pull_requests repo_pr ON repo_pr.id = followup.followup_repo_pr_id
    WHERE followup.source_work_item_id IN (${placeholders(workItemIds.length)})
    ORDER BY followup.detected_at DESC, followup.id DESC
  `).all(...workItemIds) as FollowupRecord[];
  for (const row of rows) {
    const list = grouped.get(row.source_work_item_id) || [];
    list.push(row);
    grouped.set(row.source_work_item_id, list);
  }
  return grouped;
}

function summarizeRuns(runs: MatchedRun[]): {
  latestRun: MatchedRun | null;
  knownCost: number | null;
  unknownCostRuns: number;
} {
  if (runs.length === 0) {
    return { latestRun: null, knownCost: null, unknownCostRuns: 0 };
  }

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

  return {
    latestRun: runs[runs.length - 1] || null,
    knownCost: hasKnownCost ? knownCost : null,
    unknownCostRuns,
  };
}

function outcomeFromPrState(state: string | null): OutcomeState {
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed_unmerged";
  if (state === "OPEN") return "pending_pr";
  return "pending_pr";
}

function asOutcomeState(value: string | null): OutcomeState | null {
  if (value === "no_pr" || value === "pending_pr" || value === "merged" || value === "closed_unmerged" || value === "unknown") {
    return value;
  }
  return null;
}

function parseSnapshotEvidence(value: string | null): OutcomeRow["snapshot_evidence"] {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      rules_version: Number(parsed.rules_version) || 1,
      quality_reason: String(parsed.quality_reason || parsed.reason || ""),
      deterministic_quality_band: parsed.deterministic_quality_band === "pending" || parsed.deterministic_quality_band === "strong" || parsed.deterministic_quality_band === "useful" || parsed.deterministic_quality_band === "costly_reworked" || parsed.deterministic_quality_band === "abandoned" || parsed.deterministic_quality_band === "unknown"
        ? parsed.deterministic_quality_band
        : null,
      deterministic_quality_reason: typeof parsed.deterministic_quality_reason === "string" ? parsed.deterministic_quality_reason : null,
      assessment_quality_reason: typeof parsed.assessment_quality_reason === "string" ? parsed.assessment_quality_reason : null,
      llm_assessment: parsed.llm_assessment && typeof parsed.llm_assessment === "object"
        ? normalizeOutcomeEvidenceAssessment(parsed.llm_assessment)
        : null,
      attribution_reason: String(parsed.attribution_reason || ""),
      changes_requested_count: Number(parsed.changes_requested_count) || 0,
      correction_burden_inputs: {
        review_comment_count: Number(parsed.correction_burden_inputs?.review_comment_count) || 0,
        changes_requested_count: Number(parsed.correction_burden_inputs?.changes_requested_count) || 0,
        human_after_agent_commit_count: Number(parsed.correction_burden_inputs?.human_after_agent_commit_count) || 0,
        extra_issue_comment_count: Number(parsed.correction_burden_inputs?.extra_issue_comment_count) || 0,
      },
      pr_author: {
        login: typeof parsed.pr_author?.login === "string" ? parsed.pr_author.login : null,
        classification: parsed.pr_author?.classification === "agent" || parsed.pr_author?.classification === "known_user" || parsed.pr_author?.classification === "human" || parsed.pr_author?.classification === "unknown"
          ? parsed.pr_author.classification
          : "unknown",
        confidence: parsed.pr_author?.confidence === "unknown" || parsed.pr_author?.confidence === "low" || parsed.pr_author?.confidence === "medium" || parsed.pr_author?.confidence === "high"
          ? parsed.pr_author.confidence
          : "unknown",
      },
      pr_artifact_warnings: Array.isArray(parsed.pr_artifact_warnings)
        ? parsed.pr_artifact_warnings.map((entry: unknown) => String(entry)).filter(Boolean)
        : [],
      commit_classifications: Array.isArray(parsed.commit_classifications)
        ? parsed.commit_classifications.map((entry: any) => ({
          sha: String(entry?.sha || ""),
          classification: entry?.classification === "agent_authored" || entry?.classification === "agent_coauthored" || entry?.classification === "human_authored" || entry?.classification === "unknown"
            ? entry.classification
            : "unknown",
          signals: Array.isArray(entry?.signals) ? entry.signals.map((signal: unknown) => String(signal)).filter(Boolean) : [],
          author_login: typeof entry?.author_login === "string" ? entry.author_login : null,
          author_email: typeof entry?.author_email === "string" ? entry.author_email : null,
          committer_login: typeof entry?.committer_login === "string" ? entry.committer_login : null,
          authored_at: typeof entry?.authored_at === "string" ? entry.authored_at : null,
        }))
        : [],
    };
  } catch {
    return null;
  }
}

function parseAssessmentSummary(value: string | null): string | null {
  const assessment = parseOutcomeEvidenceAssessment(value);
  return assessment?.summary || null;
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseFollowupSummary(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.summary === "string" ? parsed.summary : null;
  } catch {
    return null;
  }
}

function isRegressionFollowup(row: FollowupRecord): boolean {
  if (row.confidence === "unknown" || row.confidence === "low") return false;
  return row.relation_type === "regression_fix" || row.relation_type === "revert" || row.relation_type === "agent_correction";
}

function costBucketForState(state: OutcomeState): keyof OutcomeCostBuckets | null {
  if (state === "pending_pr") return "pending_pr_cost_usd";
  if (state === "merged") return "merged_pr_cost_usd";
  if (state === "closed_unmerged") return "closed_unmerged_cost_usd";
  if (state === "no_pr") return "no_pr_cost_usd";
  if (state === "unknown") return "unknown_outcome_cost_usd";
  return null;
}

function buildFilters(apps: AppRow[], rows: OutcomeRow[]): OutcomesSummaryResponse["filters"] {
  const providers = new Set<string>();
  const models = new Set<string>();
  const runStatuses = new Set<string>();
  const outcomeStates = new Set<OutcomeState>();
  const prStates = new Set<string>();

  for (const row of rows) {
    if (row.provider_id) providers.add(row.provider_id);
    if (row.model_id) models.add(row.model_id);
    if (row.latest_run_status) runStatuses.add(row.latest_run_status);
    outcomeStates.add(row.outcome_state);
    prStates.add(row.pr_state || "NO_PR");
  }

  return {
    apps: apps.map((app) => ({ id: app.id, name: app.name })),
    providers: Array.from(providers).sort(),
    models: Array.from(models).sort(),
    run_statuses: Array.from(runStatuses).sort(),
    outcome_states: Array.from(outcomeStates).sort(),
    pr_states: Array.from(prStates).sort(),
  };
}

function buildCoverage(rows: OutcomeRow[]): OutcomeCoverageCounts {
  const coverage = emptyCoverage();
  for (const row of rows) {
    if (row.github_evidence_synced_at) coverage.github_evidence_synced_rows += 1;
    if (row.snapshot_computed_at) coverage.computed_snapshot_rows += 1;
    if (row.assessment_status === "completed") coverage.assessed_evidence_rows += 1;
    if (row.followup_count > 0) coverage.followup_rows += 1;
    if (row.regression_followup_count > 0) coverage.regression_followup_rows += 1;
    if (row.quality_band) {
      coverage.quality_counts[row.quality_band] = (coverage.quality_counts[row.quality_band] || 0) + 1;
    }
  }
  return coverage;
}

function applyRowFilters(rows: OutcomeRow[], filters: OutcomeRowFilters | undefined): OutcomeRow[] {
  if (!filters) return rows;
  return rows.filter((row) => {
    if (filters.appId && row.app_id !== filters.appId) return false;
    if (filters.outcomeState && row.outcome_state !== filters.outcomeState) return false;
    if (filters.providerId && row.provider_id !== filters.providerId) return false;
    if (filters.modelId && row.model_id !== filters.modelId) return false;
    if (filters.runStatus && row.latest_run_status !== filters.runStatus) return false;
    if (filters.prState && (row.pr_state || "NO_PR") !== filters.prState) return false;
    return true;
  });
}

function paginateOutcomeRows(rows: OutcomeRow[], totalRows: number, pageSizeInput: number | undefined, pageInput: number | undefined): {
  rows: OutcomeRow[];
  pagination: OutcomesSummaryResponse["pagination"];
} {
  const pageSize = Math.min(200, Math.max(1, Math.floor(pageSizeInput || 25)));
  const pageCount = rows.length === 0 ? 0 : Math.ceil(rows.length / pageSize);
  const requestedPage = Math.max(1, Math.floor(pageInput || 1));
  const page = pageCount === 0 ? 1 : Math.min(requestedPage, pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    pagination: {
      page,
      page_size: pageSize,
      total_rows: totalRows,
      filtered_rows: rows.length,
      page_count: pageCount,
      has_previous: page > 1,
      has_next: pageCount > 0 && page < pageCount,
    },
  };
}

function paginateRows(rows: OutcomeRow[], totalRows: number, pagination: OutcomePaginationOptions | undefined): {
  rows: OutcomeRow[];
  pagination: OutcomesSummaryResponse["pagination"];
} {
  return paginateOutcomeRows(rows, totalRows, pagination?.pageSize, pagination?.page);
}

function paginateOutcomeGroups(
  rows: OutcomeRow[],
  filteredRows: OutcomeRow[],
  options: OutcomeGroupPaginationOptions | undefined,
): OutcomeRowGroup[] {
  const totalRowsByState = new Map<OutcomeState, number>();
  const filteredRowsByState = new Map<OutcomeState, OutcomeRow[]>();
  for (const state of OUTCOME_GROUP_ORDER) {
    totalRowsByState.set(state, 0);
    filteredRowsByState.set(state, []);
  }
  for (const row of rows) {
    totalRowsByState.set(row.outcome_state, (totalRowsByState.get(row.outcome_state) || 0) + 1);
  }
  for (const row of filteredRows) {
    filteredRowsByState.get(row.outcome_state)?.push(row);
  }

  return OUTCOME_GROUP_ORDER.map((state) => {
    const groupRows = filteredRowsByState.get(state) || [];
    const paged = paginateOutcomeRows(
      groupRows,
      totalRowsByState.get(state) || 0,
      options?.pageSize,
      options?.pagesByState?.[state],
    );
    return {
      state,
      rows: paged.rows,
      pagination: paged.pagination,
    };
  });
}

export async function buildOutcomesSummary({
  apps,
  githubToken = null,
  githubUnavailableWarning,
  maxGithubLookups = null,
  refreshGitHubState = true,
  rowFilters,
  pagination,
  groupPagination,
  prLookup = getPullRequest,
}: BuildOutcomesOptions): Promise<OutcomesSummaryResponse> {
  const warnings: string[] = [];
  if (apps.length === 0) return emptySummary(apps);

  const appIds = apps.map((app) => app.id);
  const records = getDb().prepare(`
    SELECT
      app.id AS app_id,
      app.name AS app_name,
      app.github_repo AS app_github_repo,
      wi.id AS work_item_id,
      wi.title AS work_item_title,
      wi.status AS work_item_status,
      wi.created_at AS work_item_created_at,
      wi.updated_at AS work_item_updated_at,
      c.id AS conversation_id,
      c.title AS conversation_title,
      env.branch_name AS branch_name,
      session.id AS session_id,
      session.provider_id AS session_provider_id,
      session.external_session_id AS external_session_id,
      session.status AS session_status,
      session.last_model_id AS last_model_id,
      pr.id AS pr_artifact_id,
      pr.metadata_json AS pr_metadata_json,
      evidence.synced_at AS evidence_synced_at,
      evidence.state AS evidence_state,
      evidence.pr_url AS evidence_pr_url,
      evidence.title AS evidence_title,
      evidence.merged_at AS evidence_merged_at,
      evidence.closed_at AS evidence_closed_at,
      evidence.issue_comments_count AS evidence_issue_comments_count,
      evidence.review_comments_count AS evidence_review_comments_count,
      evidence.reviews_count AS evidence_reviews_count,
      evidence.commits_count AS evidence_commits_count,
      evidence.additions AS evidence_additions,
      evidence.deletions AS evidence_deletions,
      evidence.changed_files AS evidence_changed_files,
      snapshot.id AS snapshot_id,
      snapshot.assessment_id AS snapshot_assessment_id,
      snapshot.outcome_state AS snapshot_outcome_state,
      snapshot.quality_band AS snapshot_quality_band,
      snapshot.confidence AS snapshot_confidence,
      snapshot.pr_author_login AS snapshot_pr_author_login,
      snapshot.pr_author_classification AS snapshot_pr_author_classification,
      snapshot.pr_author_confidence AS snapshot_pr_author_confidence,
      snapshot.attribution_confidence AS snapshot_attribution_confidence,
      snapshot.computed_at AS snapshot_computed_at,
      snapshot.evidence_json AS snapshot_evidence_json,
      snapshot.correction_burden_score AS snapshot_correction_burden_score,
      snapshot.human_commit_count AS snapshot_human_commit_count,
      snapshot.agent_commit_count AS snapshot_agent_commit_count,
      snapshot.coauthored_commit_count AS snapshot_coauthored_commit_count,
      snapshot.unknown_commit_count AS snapshot_unknown_commit_count,
      snapshot.human_after_agent_commit_count AS snapshot_human_after_agent_commit_count,
      assessment.id AS assessment_id,
      assessment.status AS assessment_status,
      assessment.confidence AS assessment_confidence,
      assessment.provider_id AS assessment_provider_id,
      assessment.model_id AS assessment_model_id,
      assessment.assessment_json AS assessment_json,
      assessment.created_at AS assessment_created_at
    FROM work_items wi
    JOIN apps app ON app.id = wi.app_id
    LEFT JOIN conversations c ON c.id = wi.primary_conversation_id
    LEFT JOIN work_item_env env ON env.work_item_id = wi.id
    LEFT JOIN agent_sessions session ON session.id = (
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
    LEFT JOIN llm_outcome_snapshots snapshot ON snapshot.work_item_id = wi.id
    LEFT JOIN llm_outcome_assessments assessment ON assessment.id = COALESCE(
      snapshot.assessment_id,
      (
        SELECT id FROM llm_outcome_assessments
        WHERE work_item_id = wi.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      )
    )
    WHERE wi.app_id IN (${placeholders(appIds.length)})
    ORDER BY wi.updated_at DESC, wi.id DESC
  `).all(...appIds) as OutcomeRecord[];

  if (records.length === 0) return emptySummary(apps);

  const runsByWorkItem = groupRunsByWorkItem(records.map((record) => record.work_item_id));
  const followupsByWorkItem = groupFollowupsByWorkItem(records.map((record) => record.work_item_id));
  const rows: OutcomeRow[] = records.map((record) => {
    const runs = runsByWorkItem.get(record.work_item_id) || [];
    const { latestRun, knownCost, unknownCostRuns } = summarizeRuns(runs);
    const pr = parsePullRequestMetadata(record.pr_metadata_json);
    const rowWarnings = [...pr.warnings];
    const hasPrArtifact = record.pr_artifact_id !== null;
    const hasValidPr = hasPrArtifact && pr.prNumber !== null;
    const providerId = latestRun?.provider_id || record.session_provider_id || null;
    const modelId = latestRun?.model_id || record.last_model_id || null;
    const followups = followupsByWorkItem.get(record.work_item_id) || [];
    const regressionFollowups = followups.filter(isRegressionFollowup);

    let outcomeState: OutcomeState = "no_pr";
    let evidenceCompleteness: OutcomeEvidenceCompleteness = "no_pr_artifact";
    if (hasPrArtifact && hasValidPr) {
      outcomeState = "pending_pr";
      evidenceCompleteness = "local_pr_artifact";
    } else if (hasPrArtifact) {
      outcomeState = "unknown";
      evidenceCompleteness = "incomplete";
    }

    const syncedState = record.evidence_state === "MERGED" || record.evidence_state === "CLOSED" || record.evidence_state === "OPEN"
      ? record.evidence_state
      : null;
    if (syncedState) {
      outcomeState = outcomeFromPrState(syncedState);
      evidenceCompleteness = "github_enriched";
    }
    const snapshotOutcomeState = asOutcomeState(record.snapshot_outcome_state);
    if (snapshotOutcomeState) {
      outcomeState = snapshotOutcomeState;
    }

    return {
      id: `work-item-${record.work_item_id}`,
      app_id: record.app_id,
      app_name: record.app_name,
      app_github_repo: record.app_github_repo || null,
      work_item_id: record.work_item_id,
      work_item_title: record.work_item_title,
      work_item_status: record.work_item_status,
      conversation_id: record.conversation_id,
      conversation_title: record.conversation_title,
      branch_name: record.branch_name,
      provider_id: providerId,
      model_id: modelId,
      session_id: record.session_id,
      external_session_id: record.external_session_id,
      session_status: record.session_status,
      latest_run_id: latestRun?.id || null,
      latest_run_status: latestRun?.status || null,
      latest_run_workflow_key: latestRun?.workflow_key || null,
      run_count: runs.length,
      known_cost_usd: knownCost,
      unknown_cost_runs: unknownCostRuns,
      pr_number: pr.prNumber,
      pr_url: record.evidence_pr_url || pr.prUrl,
      pr_title: record.evidence_title || null,
      pr_state: syncedState || (hasValidPr ? "UNKNOWN" : null),
      outcome_state: outcomeState,
      evidence_completeness: evidenceCompleteness,
      snapshot_id: record.snapshot_id,
      quality_band: record.snapshot_quality_band === "pending" || record.snapshot_quality_band === "strong" || record.snapshot_quality_band === "useful" || record.snapshot_quality_band === "costly_reworked" || record.snapshot_quality_band === "abandoned" || record.snapshot_quality_band === "unknown"
        ? record.snapshot_quality_band
        : null,
      quality_confidence: record.snapshot_confidence === "low" || record.snapshot_confidence === "medium" || record.snapshot_confidence === "high"
        ? record.snapshot_confidence
        : null,
      assessment_id: record.assessment_id || record.snapshot_assessment_id,
      assessment_status: record.assessment_status === "completed" || record.assessment_status === "failed"
        ? record.assessment_status
        : null,
      assessment_confidence: record.assessment_confidence === "unknown" || record.assessment_confidence === "low" || record.assessment_confidence === "medium" || record.assessment_confidence === "high"
        ? record.assessment_confidence
        : null,
      assessment_provider_id: record.assessment_provider_id,
      assessment_model_id: record.assessment_model_id,
      assessment_summary: parseAssessmentSummary(record.assessment_json),
      assessment_created_at: record.assessment_created_at,
      pr_author_login: record.snapshot_pr_author_login,
      pr_author_classification: record.snapshot_pr_author_classification === "agent" || record.snapshot_pr_author_classification === "known_user" || record.snapshot_pr_author_classification === "human" || record.snapshot_pr_author_classification === "unknown"
        ? record.snapshot_pr_author_classification
        : null,
      pr_author_confidence: record.snapshot_pr_author_confidence === "unknown" || record.snapshot_pr_author_confidence === "low" || record.snapshot_pr_author_confidence === "medium" || record.snapshot_pr_author_confidence === "high"
        ? record.snapshot_pr_author_confidence
        : null,
      attribution_confidence: record.snapshot_attribution_confidence === "unknown" || record.snapshot_attribution_confidence === "low" || record.snapshot_attribution_confidence === "medium" || record.snapshot_attribution_confidence === "high"
        ? record.snapshot_attribution_confidence
        : null,
      snapshot_computed_at: record.snapshot_computed_at,
      snapshot_evidence: parseSnapshotEvidence(record.snapshot_evidence_json),
      correction_burden_score: record.snapshot_correction_burden_score,
      human_commit_count: record.snapshot_human_commit_count,
      agent_commit_count: record.snapshot_agent_commit_count,
      coauthored_commit_count: record.snapshot_coauthored_commit_count,
      unknown_commit_count: record.snapshot_unknown_commit_count,
      human_after_agent_commit_count: record.snapshot_human_after_agent_commit_count,
      followup_count: followups.length,
      regression_followup_count: regressionFollowups.length,
      followup_evidence: followups.slice(0, 5).map((followup) => ({
        id: followup.id,
        relation_type: followup.relation_type === "no_relation" || followup.relation_type === "expected_iteration" || followup.relation_type === "routine_followup" || followup.relation_type === "agent_correction" || followup.relation_type === "regression_fix" || followup.relation_type === "revert" || followup.relation_type === "unknown"
          ? followup.relation_type
          : "unknown",
        confidence: followup.confidence === "unknown" || followup.confidence === "low" || followup.confidence === "medium" || followup.confidence === "high"
          ? followup.confidence
          : "unknown",
        deterministic_score: followup.deterministic_score,
        deterministic_signals: parseStringArray(followup.deterministic_signals_json),
        summary: parseFollowupSummary(followup.assessment_json),
        followup_pr_number: followup.followup_pr_number,
        followup_pr_url: followup.followup_pr_url,
        followup_title: followup.followup_title,
        detected_at: followup.detected_at,
      })),
      github_evidence_synced_at: record.evidence_synced_at,
      github_issue_comments_count: record.evidence_issue_comments_count,
      github_review_comments_count: record.evidence_review_comments_count,
      github_reviews_count: record.evidence_reviews_count,
      github_commits_count: record.evidence_commits_count,
      github_additions: record.evidence_additions,
      github_deletions: record.evidence_deletions,
      github_changed_files: record.evidence_changed_files,
      warnings: rowWarnings,
      created_at: record.work_item_created_at,
      updated_at: record.work_item_updated_at,
    };
  });

  if (refreshGitHubState && !githubToken) {
    if (rows.some((row) => row.pr_number)) {
      pushUnique(
        warnings,
        githubUnavailableWarning || "GitHub is not connected for this user, so PR states are based on local Archie evidence only.",
      );
    }
  } else if (refreshGitHubState && githubToken) {
    let lookups = 0;
    for (const row of rows) {
      if (!row.pr_number) continue;
      if (maxGithubLookups !== null && maxGithubLookups >= 0 && lookups >= maxGithubLookups) {
        row.warnings.push("GitHub PR state was not refreshed because the lookup limit was reached.");
        pushUnique(warnings, `GitHub enrichment was capped at ${maxGithubLookups} PRs for this request.`);
        continue;
      }

      const remote = resolvePullRequestRepo({ appGithubRepo: row.app_github_repo, prUrl: row.pr_url });
      if (!remote) {
        row.warnings.push("GitHub PR state was not refreshed because no valid GitHub repository could be resolved.");
        continue;
      }

      lookups += 1;
      try {
        const prInfo = await prLookup({
          owner: remote.owner,
          repo: remote.repo,
          pr_number: row.pr_number,
          token: githubToken,
        });
        if (!prInfo) {
          row.warnings.push("GitHub PR lookup returned no result.");
          continue;
        }
        row.pr_state = prInfo.state === "MERGED" || prInfo.state === "CLOSED" || prInfo.state === "OPEN"
          ? prInfo.state
          : "UNKNOWN";
        row.pr_url = prInfo.pr_url || row.pr_url;
        row.pr_title = prInfo.title || row.pr_title;
        row.outcome_state = outcomeFromPrState(row.pr_state);
        row.evidence_completeness = "github_enriched";
      } catch {
        row.warnings.push("GitHub PR state refresh failed.");
        pushUnique(warnings, "One or more GitHub PR lookups failed; local evidence is still shown.");
      }
    }
  }

  const counts = emptySummary(apps, warnings).counts;
  const costs = emptySummary(apps, warnings).costs;
  for (const row of rows) {
    counts.total_work_items += 1;
    if (row.session_id || row.run_count > 0) counts.total_sessions += 1;
    if (row.pr_number || row.pr_url) counts.pr_linked_work += 1;
    if (row.outcome_state === "pending_pr") counts.pending_prs += 1;
    if (row.outcome_state === "merged") counts.merged_prs += 1;
    if (row.outcome_state === "closed_unmerged") counts.closed_unmerged_prs += 1;
    if (row.outcome_state === "no_pr") counts.no_pr_work += 1;
    if (row.outcome_state === "unknown") counts.unknown_outcome += 1;
    if (row.known_cost_usd === null || row.unknown_cost_runs > 0) counts.rows_with_unknown_cost += 1;
    counts.unknown_cost_runs += row.unknown_cost_runs;

    if (row.known_cost_usd !== null) {
      costs.total_known_cost_usd += row.known_cost_usd;
      const bucket = costBucketForState(row.outcome_state);
      if (bucket) costs[bucket] += row.known_cost_usd;
    }
  }
  const filteredRows = applyRowFilters(rows, rowFilters);
  const paged = paginateRows(filteredRows, rows.length, pagination);
  const rowGroups = paginateOutcomeGroups(rows, filteredRows, groupPagination);

  return {
    generated_at: new Date().toISOString(),
    counts,
    costs,
    coverage: buildCoverage(rows),
    rows: paged.rows,
    row_groups: rowGroups,
    pagination: paged.pagination,
    filters: buildFilters(apps, rows),
    warnings,
  };
}
