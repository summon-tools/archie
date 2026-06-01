import { getDb } from "@/lib/server/db";
import { getPullRequest, parseGitHubRemoteUrl } from "@/lib/server/github";
import type { AppRow, RunRow } from "@/lib/server/types";
import type {
  OutcomeCostBuckets,
  OutcomeEvidenceCompleteness,
  OutcomeRow,
  OutcomesSummaryResponse,
  OutcomeState,
} from "@/lib/types";

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
  maxGithubLookups?: number;
  prLookup?: PullRequestLookup;
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
  pr_metadata_json: string | null;
  pr_artifact_id: number | null;
};

type MatchedRun = RunRow & { matched_work_item_id: number };

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
    rows: [],
    filters: {
      apps: apps.map((app) => ({ id: app.id, name: app.name })),
      providers: [],
      models: [],
      run_statuses: [],
      outcome_states: [],
    },
    warnings,
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

function parsePrMetadata(metadataJson: string | null): {
  prNumber: number | null;
  prUrl: string | null;
  warnings: string[];
} {
  if (!metadataJson) {
    return { prNumber: null, prUrl: null, warnings: [] };
  }

  try {
    const parsed = JSON.parse(metadataJson);
    const rawNumber = parsed?.pr_number;
    const numberValue = typeof rawNumber === "number" ? rawNumber : Number(rawNumber);
    const prUrl = typeof parsed?.pr_url === "string" && parsed.pr_url.trim() ? parsed.pr_url.trim() : null;
    const urlNumberMatch = prUrl?.match(/\/pull\/(\d+)(?:[/?#].*)?$/);
    const parsedUrlNumber = urlNumberMatch ? Number(urlNumberMatch[1]) : null;
    const prNumber = Number.isInteger(numberValue) && numberValue > 0
      ? numberValue
      : parsedUrlNumber;
    const warnings: string[] = [];
    if (!prNumber) warnings.push("PR artifact is missing a valid PR number.");
    return { prNumber, prUrl, warnings };
  } catch {
    return { prNumber: null, prUrl: null, warnings: ["PR artifact metadata is not valid JSON."] };
  }
}

function parseGitHubPullRequestUrl(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;
  const match = url.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+(?:[/?#].*)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function resolvePullRequestRepo(row: OutcomeRow): { owner: string; repo: string } | null {
  return (row.app_github_repo ? parseGitHubRemoteUrl(row.app_github_repo) : null)
    || parseGitHubPullRequestUrl(row.pr_url);
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

  for (const row of rows) {
    if (row.provider_id) providers.add(row.provider_id);
    if (row.model_id) models.add(row.model_id);
    if (row.latest_run_status) runStatuses.add(row.latest_run_status);
    outcomeStates.add(row.outcome_state);
  }

  return {
    apps: apps.map((app) => ({ id: app.id, name: app.name })),
    providers: Array.from(providers).sort(),
    models: Array.from(models).sort(),
    run_statuses: Array.from(runStatuses).sort(),
    outcome_states: Array.from(outcomeStates).sort(),
  };
}

export async function buildOutcomesSummary({
  apps,
  githubToken = null,
  githubUnavailableWarning,
  maxGithubLookups = 25,
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
      pr.metadata_json AS pr_metadata_json
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
    WHERE wi.app_id IN (${placeholders(appIds.length)})
    ORDER BY wi.updated_at DESC, wi.id DESC
  `).all(...appIds) as OutcomeRecord[];

  if (records.length === 0) return emptySummary(apps);

  const runsByWorkItem = groupRunsByWorkItem(records.map((record) => record.work_item_id));
  const rows: OutcomeRow[] = records.map((record) => {
    const runs = runsByWorkItem.get(record.work_item_id) || [];
    const { latestRun, knownCost, unknownCostRuns } = summarizeRuns(runs);
    const pr = parsePrMetadata(record.pr_metadata_json);
    const rowWarnings = [...pr.warnings];
    const hasPrArtifact = record.pr_artifact_id !== null;
    const hasValidPr = hasPrArtifact && pr.prNumber !== null;
    const providerId = latestRun?.provider_id || record.session_provider_id || null;
    const modelId = latestRun?.model_id || record.last_model_id || null;

    let outcomeState: OutcomeState = "no_pr";
    let evidenceCompleteness: OutcomeEvidenceCompleteness = "no_pr_artifact";
    if (hasPrArtifact && hasValidPr) {
      outcomeState = "pending_pr";
      evidenceCompleteness = "local_pr_artifact";
    } else if (hasPrArtifact) {
      outcomeState = "unknown";
      evidenceCompleteness = "incomplete";
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
      pr_url: pr.prUrl,
      pr_title: null,
      pr_state: hasValidPr ? "UNKNOWN" : null,
      outcome_state: outcomeState,
      evidence_completeness: evidenceCompleteness,
      warnings: rowWarnings,
      created_at: record.work_item_created_at,
      updated_at: record.work_item_updated_at,
    };
  });

  if (!githubToken) {
    if (rows.some((row) => row.pr_number)) {
      pushUnique(
        warnings,
        githubUnavailableWarning || "GitHub is not connected for this user, so PR states are based on local Archie evidence only.",
      );
    }
  } else {
    let lookups = 0;
    for (const row of rows) {
      if (!row.pr_number) continue;
      if (lookups >= maxGithubLookups) {
        row.warnings.push("GitHub PR state was not refreshed because the lookup limit was reached.");
        pushUnique(warnings, `GitHub enrichment was capped at ${maxGithubLookups} PRs for this request.`);
        continue;
      }

      const remote = resolvePullRequestRepo(row);
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

  const counts = emptySummary(apps).counts;
  const costs = emptySummary(apps).costs;
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

  return {
    generated_at: new Date().toISOString(),
    counts,
    costs,
    rows,
    filters: buildFilters(apps, rows),
    warnings,
  };
}
