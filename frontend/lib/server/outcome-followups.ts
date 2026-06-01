import * as dal from "@/lib/server/dal";
import { getDb } from "@/lib/server/db";
import { getModelForCategory } from "@/lib/server/config";
import { getPullRequestFiles, listRepositoryPullRequests } from "@/lib/server/github";
import { getOutcomesGitHubSyncSettings } from "@/lib/server/outcomes-github-sync";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import type {
  AppRow,
  GitHubRepoPullRequestFileRow,
  GitHubRepoPullRequestRow,
  LlmAttributionConfidence,
  LlmOutcomeFollowupRelation,
  LlmOutcomeFollowupRow,
} from "@/lib/server/types";

type SourceOutcomePr = {
  app_id: number;
  source_work_item_id: number;
  source_snapshot_id: number;
  source_pr_snapshot_id: number;
  owner: string;
  repo: string;
  source_pr_number: number;
  source_pr_url: string;
  source_title: string;
  source_state: string;
  source_author_login: string | null;
  source_merged_at: string | null;
  source_closed_at: string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
  source_raw_json: string | null;
  source_quality_band: string;
  source_evidence_json: string | null;
};

export interface OutcomeFollowupAssessment {
  relation_type: LlmOutcomeFollowupRelation;
  confidence: LlmAttributionConfidence;
  evidence_ids: string[];
  summary: string;
}

export interface OutcomeFollowupVerificationPacket {
  source: {
    work_item_id: number;
    pr_number: number;
    title: string;
    merged_at: string | null;
    quality_band: string;
    files: string[];
    assessment_summary: string | null;
  };
  followup: {
    pr_number: number;
    title: string;
    body: string;
    state: string;
    created_at: string | null;
    merged_at: string | null;
    files: string[];
  };
  deterministic: {
    score: number;
    signals: string[];
    exact_file_overlap: string[];
    directory_overlap: string[];
  };
}

export type OutcomeFollowupVerifier = (packet: OutcomeFollowupVerificationPacket) => Promise<OutcomeFollowupAssessment>;

export interface RunOutcomeFollowupDetectionOptions {
  apps: AppRow[];
  githubToken: string;
  observationDays?: number | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  rangeDays?: number | null;
  maxRepoPages?: number;
  maxCandidates?: number;
  fetchRepositoryPullRequests?: (params: { owner: string; repo: string; token: string; maxPages: number }) => Promise<Array<Record<string, any>>>;
  fetchPullRequestFiles?: (params: { owner: string; repo: string; pr_number: number; token: string }) => Promise<Array<Record<string, any>>>;
  verifier?: OutcomeFollowupVerifier;
}

export interface RunOutcomeFollowupDetectionResult {
  scanned_source_prs: number;
  indexed_repo_prs: number;
  candidate_count: number;
  detected_count: number;
  regression_count: number;
  followup_ids: number[];
  generated_at: string;
  warnings: string[];
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function addDays(value: string, days: number): string {
  const parsed = parseTime(value) || Date.now();
  return new Date(parsed + days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "").toLowerCase();
}

function fileArea(filename: string): string {
  const parts = filename.split("/").filter(Boolean);
  if (parts.length <= 1) return filename;
  return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  if (start < 0) throw new Error("Follow-up response did not contain a JSON object");
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
  throw new Error("Follow-up response JSON was incomplete");
}

function normalizeRelation(value: unknown): LlmOutcomeFollowupRelation {
  return value === "no_relation" ||
    value === "expected_iteration" ||
    value === "routine_followup" ||
    value === "agent_correction" ||
    value === "regression_fix" ||
    value === "revert" ||
    value === "unknown"
    ? value
    : "unknown";
}

function normalizeConfidence(value: unknown): LlmAttributionConfidence {
  return value === "unknown" || value === "low" || value === "medium" || value === "high" ? value : "unknown";
}

function normalizeAssessment(value: unknown): OutcomeFollowupAssessment {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    relation_type: normalizeRelation(source.relation_type),
    confidence: normalizeConfidence(source.confidence),
    evidence_ids: Array.isArray(source.evidence_ids) ? source.evidence_ids.map((entry) => String(entry)).filter(Boolean).slice(0, 20) : [],
    summary: typeof source.summary === "string" ? source.summary.trim().slice(0, 500) : "",
  };
}

function parseSourceAssessmentSummary(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const assessment = parsed?.llm_assessment;
    return typeof assessment?.summary === "string" ? assessment.summary : null;
  } catch {
    return null;
  }
}

function pullRequestInputFromGitHub(owner: string, repo: string, pr: Record<string, any>) {
  return {
    owner,
    repo,
    pr_number: Number(pr.number),
    pr_url: String(pr.html_url || ""),
    title: pr.title || "",
    body: pr.body || "",
    state: pr.merged_at ? "MERGED" : String(pr.state || "UNKNOWN").toUpperCase(),
    author_login: pr.user?.login ?? null,
    head_ref: pr.head?.ref ?? null,
    base_ref: pr.base?.ref ?? null,
    merged_at: pr.merged_at ?? null,
    closed_at: pr.closed_at ?? null,
    github_created_at: pr.created_at ?? null,
    github_updated_at: pr.updated_at ?? null,
    additions: typeof pr.additions === "number" ? pr.additions : null,
    deletions: typeof pr.deletions === "number" ? pr.deletions : null,
    changed_files: typeof pr.changed_files === "number" ? pr.changed_files : null,
    raw_json: JSON.stringify(pr),
  };
}

function pullRequestInputFromSource(source: SourceOutcomePr) {
  let body = "";
  try {
    const parsed = source.source_raw_json ? JSON.parse(source.source_raw_json) : null;
    body = typeof parsed?.body === "string" ? parsed.body : "";
  } catch {
    body = "";
  }
  return {
    owner: source.owner,
    repo: source.repo,
    pr_number: source.source_pr_number,
    pr_url: source.source_pr_url,
    title: source.source_title,
    body,
    state: source.source_state,
    author_login: source.source_author_login,
    merged_at: source.source_merged_at,
    closed_at: source.source_closed_at,
    github_created_at: source.source_created_at,
    github_updated_at: source.source_updated_at,
    raw_json: source.source_raw_json,
  };
}

function getSourceOutcomePrs(apps: AppRow[], rangeStart: string | null, rangeEnd: string | null): SourceOutcomePr[] {
  if (apps.length === 0) return [];
  const appIds = apps.map((app) => app.id);
  const conditions = [
    `snapshot.app_id IN (${placeholders(appIds.length)})`,
    "snapshot.outcome_state = 'merged'",
    "pr.merged_at IS NOT NULL",
  ];
  const params: unknown[] = [...appIds];
  if (rangeStart) {
    conditions.push("datetime(pr.merged_at) >= datetime(?)");
    params.push(rangeStart);
  }
  if (rangeEnd) {
    conditions.push("datetime(pr.merged_at) <= datetime(?)");
    params.push(rangeEnd);
  }
  return getDb().prepare(`
    SELECT
      snapshot.app_id AS app_id,
      snapshot.work_item_id AS source_work_item_id,
      snapshot.id AS source_snapshot_id,
      snapshot.pr_snapshot_id AS source_pr_snapshot_id,
      snapshot.quality_band AS source_quality_band,
      snapshot.evidence_json AS source_evidence_json,
      pr.owner AS owner,
      pr.repo AS repo,
      pr.pr_number AS source_pr_number,
      pr.pr_url AS source_pr_url,
      pr.title AS source_title,
      pr.state AS source_state,
      pr.author_login AS source_author_login,
      pr.merged_at AS source_merged_at,
      pr.closed_at AS source_closed_at,
      pr.github_created_at AS source_created_at,
      pr.github_updated_at AS source_updated_at,
      pr.raw_json AS source_raw_json
    FROM llm_outcome_snapshots snapshot
    JOIN github_pr_snapshots pr ON pr.id = snapshot.pr_snapshot_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY pr.merged_at DESC, snapshot.id DESC
  `).all(...params) as SourceOutcomePr[];
}

function listIndexedFollowupPrs(source: SourceOutcomePr, observationDays: number): GitHubRepoPullRequestRow[] {
  const mergedAt = source.source_merged_at;
  if (!mergedAt) return [];
  const end = addDays(mergedAt, observationDays);
  return getDb().prepare(`
    SELECT *
    FROM github_repo_pull_requests
    WHERE owner = ?
      AND repo = ?
      AND pr_number != ?
      AND datetime(COALESCE(github_created_at, github_updated_at, created_at)) > datetime(?)
      AND datetime(COALESCE(github_created_at, github_updated_at, created_at)) <= datetime(?)
    ORDER BY COALESCE(merged_at, closed_at, github_updated_at, github_created_at) ASC, pr_number ASC
  `).all(source.owner, source.repo, source.source_pr_number, mergedAt, end) as GitHubRepoPullRequestRow[];
}

function detectCandidate(source: SourceOutcomePr, sourceFiles: GitHubRepoPullRequestFileRow[], followup: GitHubRepoPullRequestRow, followupFiles: GitHubRepoPullRequestFileRow[]) {
  const signals: string[] = [];
  let score = 0;
  const sourceFileNames = new Set(sourceFiles.map((file) => file.filename));
  const followupFileNames = new Set(followupFiles.map((file) => file.filename));
  const exactFileOverlap = Array.from(sourceFileNames).filter((filename) => followupFileNames.has(filename)).slice(0, 20);
  const sourceAreas = new Set(sourceFiles.map((file) => fileArea(file.filename)).filter(Boolean));
  const followupAreas = new Set(followupFiles.map((file) => fileArea(file.filename)).filter(Boolean));
  const directoryOverlap = Array.from(sourceAreas).filter((area) => followupAreas.has(area)).slice(0, 20);
  if (exactFileOverlap.length > 0) {
    score += 3 + Math.min(3, exactFileOverlap.length);
    signals.push(`file_overlap:${exactFileOverlap.length}`);
  }
  if (directoryOverlap.length > 0) {
    score += 1;
    signals.push(`directory_overlap:${directoryOverlap.length}`);
  }

  const text = normalizeText(`${followup.title}\n${followup.body}\n${followup.head_ref}`);
  const sourceTitle = normalizeText(source.source_title);
  const sourceTitleToken = sourceTitle.split(/\W+/).filter((token) => token.length >= 6)[0];
  if (text.includes(`#${source.source_pr_number}`) || text.includes(`pull/${source.source_pr_number}`)) {
    score += 5;
    signals.push("references_source_pr");
  }
  if (sourceTitleToken && text.includes(sourceTitleToken)) {
    score += 2;
    signals.push("mentions_source_title");
  }
  if (/\brevert(ed|ing)?\b/.test(text)) {
    score += 6;
    signals.push("revert_language");
  }
  if (/\b(regression|broken|breaks|failing|failed|bug|hotfix|incident)\b/.test(text)) {
    score += 4;
    signals.push("bug_or_regression_language");
  }
  if (/\b(fix|fixes|fixed|repair|patch|correct|corrects|corrected)\b/.test(text)) {
    score += 2;
    signals.push("fix_language");
  }
  if (/\bfollow[- ]?up\b/.test(text)) {
    score += 1;
    signals.push("followup_language");
  }

  const hasRelationshipSignal = exactFileOverlap.length > 0 || directoryOverlap.length > 0 || signals.includes("references_source_pr") || signals.includes("mentions_source_title");
  if (!hasRelationshipSignal || score < 4) return null;
  return { score, signals, exactFileOverlap, directoryOverlap };
}

function deterministicAssessment(candidate: ReturnType<typeof detectCandidate>): OutcomeFollowupAssessment {
  const signals = candidate?.signals || [];
  if (signals.includes("revert_language")) {
    return { relation_type: "revert", confidence: "medium", evidence_ids: signals, summary: "Deterministic signals indicate a revert-like follow-up PR." };
  }
  if (signals.includes("bug_or_regression_language") && (signals.some((signal) => signal.startsWith("file_overlap")) || signals.includes("references_source_pr"))) {
    return { relation_type: "regression_fix", confidence: "medium", evidence_ids: signals, summary: "Deterministic signals indicate a likely regression fix related to the source PR." };
  }
  if (signals.includes("fix_language") && signals.some((signal) => signal.startsWith("file_overlap"))) {
    return { relation_type: "agent_correction", confidence: "low", evidence_ids: signals, summary: "Deterministic signals indicate possible correction work on overlapping files." };
  }
  return { relation_type: "routine_followup", confidence: "low", evidence_ids: signals, summary: "Deterministic signals indicate a related follow-up, but not necessarily a regression." };
}

function buildVerifierPrompt(packet: OutcomeFollowupVerificationPacket): string {
  return [
    "Classify whether a later GitHub PR is a follow-up or regression fix for an earlier Archie-assisted merged PR.",
    "",
    "Return JSON only with this exact shape:",
    "{",
    "  \"relation_type\": \"no_relation\" | \"expected_iteration\" | \"routine_followup\" | \"agent_correction\" | \"regression_fix\" | \"revert\" | \"unknown\",",
    "  \"confidence\": \"low\" | \"medium\" | \"high\" | \"unknown\",",
    "  \"evidence_ids\": string[],",
    "  \"summary\": string",
    "}",
    "",
    "Rules:",
    "- Do not infer developer productivity.",
    "- regression_fix means the later PR appears to fix behavior broken or introduced by the source PR.",
    "- agent_correction means the later PR appears to correct generated/agent work but not necessarily a product regression.",
    "- expected_iteration means planned follow-up work or normal iteration, not a defect.",
    "- routine_followup means related but no correction or regression evidence.",
    "- no_relation means same files or module overlap is incidental.",
    "- Only cite IDs/signals present in the packet.",
    "- Keep summary under 45 words.",
    "",
    "Evidence packet:",
    JSON.stringify(packet, null, 2),
  ].join("\n");
}

async function defaultVerifier(packet: OutcomeFollowupVerificationPacket): Promise<OutcomeFollowupAssessment> {
  const response = await runEphemeralQuery(buildVerifierPrompt(packet), {
    category: "quick",
    maxTurns: 1,
  });
  return normalizeAssessment(JSON.parse(extractJsonObject(response)));
}

function buildVerificationPacket(source: SourceOutcomePr, sourceFiles: GitHubRepoPullRequestFileRow[], followup: GitHubRepoPullRequestRow, followupFiles: GitHubRepoPullRequestFileRow[], candidate: NonNullable<ReturnType<typeof detectCandidate>>): OutcomeFollowupVerificationPacket {
  return {
    source: {
      work_item_id: source.source_work_item_id,
      pr_number: source.source_pr_number,
      title: source.source_title,
      merged_at: source.source_merged_at,
      quality_band: source.source_quality_band,
      files: sourceFiles.map((file) => file.filename).slice(0, 80),
      assessment_summary: parseSourceAssessmentSummary(source.source_evidence_json),
    },
    followup: {
      pr_number: followup.pr_number,
      title: followup.title,
      body: followup.body.slice(0, 2000),
      state: followup.state,
      created_at: followup.github_created_at,
      merged_at: followup.merged_at,
      files: followupFiles.map((file) => file.filename).slice(0, 80),
    },
    deterministic: {
      score: candidate.score,
      signals: candidate.signals,
      exact_file_overlap: candidate.exactFileOverlap,
      directory_overlap: candidate.directoryOverlap,
    },
  };
}

async function indexRepoPr(owner: string, repo: string, pr: Record<string, any>, token: string, fetchFiles: NonNullable<RunOutcomeFollowupDetectionOptions["fetchPullRequestFiles"]>) {
  const row = dal.upsertGitHubRepoPullRequest(pullRequestInputFromGitHub(owner, repo, pr));
  const files = await fetchFiles({ owner, repo, pr_number: row.pr_number, token });
  dal.replaceGitHubRepoPullRequestFiles({ repo_pr_id: row.id, owner, repo, pr_number: row.pr_number, files });
  return row;
}

async function ensureSourceRepoPr(source: SourceOutcomePr, token: string, fetchFiles: NonNullable<RunOutcomeFollowupDetectionOptions["fetchPullRequestFiles"]>) {
  const row = dal.upsertGitHubRepoPullRequest(pullRequestInputFromSource(source));
  const existingFiles = dal.listGitHubRepoPullRequestFiles(row.id);
  if (existingFiles.length === 0) {
    const files = await fetchFiles({ owner: source.owner, repo: source.repo, pr_number: source.source_pr_number, token });
    dal.replaceGitHubRepoPullRequestFiles({ repo_pr_id: row.id, owner: source.owner, repo: source.repo, pr_number: source.source_pr_number, files });
  }
  return row;
}

export async function runOutcomeFollowupDetection(options: RunOutcomeFollowupDetectionOptions): Promise<RunOutcomeFollowupDetectionResult> {
  const generatedAt = new Date().toISOString();
  const settings = getOutcomesGitHubSyncSettings();
  const observationDays = options.observationDays && options.observationDays > 0
    ? options.observationDays
    : settings.observation_window_days;
  const rangeStart = options.rangeStart || (options.rangeDays && options.rangeDays > 0 ? isoDaysAgo(options.rangeDays) : null);
  const rangeEnd = options.rangeEnd || new Date().toISOString();
  const fetchRepoPrs = options.fetchRepositoryPullRequests || listRepositoryPullRequests;
  const fetchFiles = options.fetchPullRequestFiles || getPullRequestFiles;
  const verifier = options.verifier || defaultVerifier;
  const maxRepoPages = options.maxRepoPages || 3;
  const maxCandidates = options.maxCandidates || 40;
  const warnings: string[] = [];
  const sources = getSourceOutcomePrs(options.apps, rangeStart, rangeEnd);
  const repoKeys = Array.from(new Set(sources.map((source) => `${source.owner}/${source.repo}`)));
  let indexedRepoPrs = 0;

  for (const key of repoKeys) {
    const [owner, repo] = key.split("/");
    try {
      const pulls = await fetchRepoPrs({ owner, repo, token: options.githubToken, maxPages: maxRepoPages });
      for (const pr of pulls) {
        const prNumber = Number(pr.number);
        if (!Number.isInteger(prNumber) || prNumber <= 0) continue;
        try {
          await indexRepoPr(owner, repo, pr, options.githubToken, fetchFiles);
          indexedRepoPrs += 1;
        } catch (error) {
          warnings.push(`Failed to index ${owner}/${repo}#${prNumber}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
    } catch (error) {
      warnings.push(`Failed to list PRs for ${key}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  let candidateCount = 0;
  let detectedCount = 0;
  let regressionCount = 0;
  const followupIds: number[] = [];
  for (const source of sources) {
    let sourceRepoPr: GitHubRepoPullRequestRow;
    try {
      sourceRepoPr = await ensureSourceRepoPr(source, options.githubToken, fetchFiles);
    } catch (error) {
      warnings.push(`Failed to index source PR ${source.owner}/${source.repo}#${source.source_pr_number}: ${error instanceof Error ? error.message : "unknown error"}`);
      continue;
    }
    const sourceFiles = dal.listGitHubRepoPullRequestFiles(sourceRepoPr.id);
    const followupPrs = listIndexedFollowupPrs(source, observationDays);
    for (const followup of followupPrs) {
      if (candidateCount >= maxCandidates) {
        warnings.push(`Follow-up detection capped at ${maxCandidates} candidates.`);
        break;
      }
      const followupFiles = dal.listGitHubRepoPullRequestFiles(followup.id);
      const candidate = detectCandidate(source, sourceFiles, followup, followupFiles);
      if (!candidate) continue;
      candidateCount += 1;
      const packet = buildVerificationPacket(source, sourceFiles, followup, followupFiles, candidate);
      let assessment = deterministicAssessment(candidate);
      try {
        assessment = normalizeAssessment(await verifier(packet));
      } catch (error) {
        warnings.push(`Verifier failed for ${source.owner}/${source.repo}#${source.source_pr_number} -> #${followup.pr_number}; deterministic classification was used.`);
      }
      if (assessment.relation_type === "no_relation") continue;
      const relationType = assessment.relation_type === "unknown" ? deterministicAssessment(candidate).relation_type : assessment.relation_type;
      const confidence = assessment.confidence === "unknown" ? deterministicAssessment(candidate).confidence : assessment.confidence;
      const row = dal.upsertLlmOutcomeFollowup({
        app_id: source.app_id,
        source_work_item_id: source.source_work_item_id,
        source_snapshot_id: source.source_snapshot_id,
        source_pr_snapshot_id: source.source_pr_snapshot_id,
        followup_repo_pr_id: followup.id,
        owner: source.owner,
        repo: source.repo,
        source_pr_number: source.source_pr_number,
        followup_pr_number: followup.pr_number,
        relation_type: relationType,
        confidence,
        deterministic_score: candidate.score,
        deterministic_signals_json: JSON.stringify(candidate.signals),
        assessment_json: JSON.stringify({ ...assessment, relation_type: relationType, confidence }),
        evidence_json: JSON.stringify(packet),
        detected_at: generatedAt,
      });
      followupIds.push(row.id);
      detectedCount += 1;
      if ((relationType === "regression_fix" || relationType === "revert" || relationType === "agent_correction") && confidence !== "low" && confidence !== "unknown") {
        regressionCount += 1;
      }
    }
  }

  return {
    scanned_source_prs: sources.length,
    indexed_repo_prs: indexedRepoPrs,
    candidate_count: candidateCount,
    detected_count: detectedCount,
    regression_count: regressionCount,
    followup_ids: followupIds,
    generated_at: generatedAt,
    warnings,
  };
}
