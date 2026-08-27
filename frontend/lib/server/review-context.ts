import { execFileSync } from "child_process";
import yaml from "js-yaml";
import * as dal from "@/lib/server/dal";
import { getDb } from "@/lib/server/db";
import { getGitHubAppInstallationToken, getGitHubAppSettings } from "@/lib/server/github-app";
import { getGitHubFileAtRef, getGitHubRefSha, loadGitHubReviewContext, type GitHubReviewContext } from "@/lib/server/github-review-api";
import type { PullRequestReviewRow, ProjectDependencyRow, ReviewPolicyRow } from "@/lib/server/types";

const MAX_LOCAL_DIFF_LENGTH = 140000;
const MAX_CONTRACT_LENGTH = 2_000_000;

export interface ReviewPolicy {
  priorities: string[];
  severity_guidance: string;
  required_checks: string[];
  behavior: string[];
  tone: string;
}

export interface NormalizedOpenApiContract {
  source_path: string;
  source_revision: string;
  openapi: string | null;
  title: string | null;
  version: string | null;
  endpoints: Array<{
    path: string;
    method: string;
    operation_id: string | null;
    parameters: string[];
    request_fields: string[];
    response_statuses: string[];
    response_fields: string[];
    authentication_requirements: string[];
    error_responses: Array<{ status: string; fields: string[] }>;
  }>;
}

export interface ReviewContextPacket {
  review: {
    id: number;
    owner: string;
    repo: string;
    number: number;
    base_sha: string;
    head_sha: string;
    comparison_sha: string;
    mode: "targeted" | "full";
  };
  pull_request: GitHubReviewContext["pull_request"];
  diff: string;
  files: GitHubReviewContext["files"];
  publication_files: GitHubReviewContext["files"];
  checks: GitHubReviewContext["checks"];
  comments: {
    issue: GitHubReviewContext["issue_comments"];
    review: GitHubReviewContext["review_comments"];
    submitted_reviews: GitHubReviewContext["reviews"];
  };
  local_checks: Array<Record<string, unknown>>;
  task: { work_item_id: number; title: string; summary: string; acceptance_criteria: string } | null;
  policy: ReviewPolicy;
  policy_revision: string;
  contracts: Array<NormalizedOpenApiContract & { dependency_id: number; provider: string; reference: string }>;
  previous_findings: Array<{
    id: number;
    path: string;
    line: number;
    end_line: number | null;
    title: string;
    body: string;
    status: string;
    evidence: unknown;
  }>;
  warnings: string[];
  sources: string[];
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function defaultPolicy(): ReviewPolicy {
  return {
    priorities: ["correctness", "security", "compatibility", "tests", "data migrations", "accessibility"],
    severity_guidance: "Publish advisory findings only; do not request changes or block merging.",
    required_checks: [],
    behavior: ["Review targeted changes by default.", "Avoid style comments handled by formatters.", "Do not invent product requirements when intent is weak.", "Every finding needs concrete code or check evidence."],
    tone: "Concise, respectful, evidence-based, and actionable.",
  };
}

function applyPolicy(base: ReviewPolicy, row: ReviewPolicyRow | undefined): ReviewPolicy {
  if (!row) return base;
  const parsed = parseJson<Partial<ReviewPolicy>>(row.policy_json, {});
  return {
    priorities: Array.isArray(parsed.priorities) ? parsed.priorities.map(String) : base.priorities,
    severity_guidance: typeof parsed.severity_guidance === "string" ? parsed.severity_guidance : base.severity_guidance,
    required_checks: Array.isArray(parsed.required_checks) ? parsed.required_checks.map(String) : base.required_checks,
    behavior: Array.isArray(parsed.behavior) ? parsed.behavior.map(String) : base.behavior,
    tone: typeof parsed.tone === "string" ? parsed.tone : base.tone,
  };
}

export function resolveReviewPolicy(layers: { company: ReviewPolicyRow | undefined; repository: ReviewPolicyRow | undefined }): { policy: ReviewPolicy; revision: string } {
  const companyPolicy = applyPolicy(defaultPolicy(), layers.company);
  const policy = applyPolicy(companyPolicy, layers.repository);
  const revisions = [layers.company?.revision, layers.repository?.revision].filter(Boolean);
  return { policy, revision: revisions.length ? revisions.join("+") : "default-v1" };
}

function gitDiff(worktreeDir: string, baseSha: string, headSha: string): string | null {
  try {
    return truncate(execFileSync("git", ["diff", "--no-ext-diff", "--unified=40", baseSha, headSha, "--"], {
      cwd: worktreeDir,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }), MAX_LOCAL_DIFF_LENGTH);
  } catch {
    try {
      return truncate(execFileSync("git", ["show", "--no-ext-diff", "--format=", "--unified=40", headSha, "--"], {
        cwd: worktreeDir,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }), MAX_LOCAL_DIFF_LENGTH);
    } catch {
      return null;
    }
  }
}

function filesFromLocalDiff(
  diff: string,
  githubFiles: GitHubReviewContext["files"],
): GitHubReviewContext["files"] {
  const githubByPath = new Map(githubFiles.map((file) => [file.filename, file]));
  const chunks = diff.split(/^diff --git /m).slice(1);
  const files: GitHubReviewContext["files"] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const plusHeader = lines.find((line) => line.startsWith("+++ b/"));
    if (!plusHeader) continue;
    const filename = plusHeader.slice("+++ b/".length);
    if (!filename || filename === "/dev/null") continue;
    const githubFile = githubByPath.get(filename);
    const additions = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const deletions = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    files.push({
      filename,
      status: githubFile?.status || "modified",
      additions,
      deletions,
      changes: additions + deletions,
      patch: chunk,
      ...(githubFile?.previous_filename ? { previous_filename: githubFile.previous_filename } : {}),
    });
  }

  return files;
}

function findLinkedTask(appId: number, owner: string, repo: string, prNumber: number): ReviewContextPacket["task"] {
  const rows = getDb().prepare(
    `SELECT a.work_item_id, wi.title AS work_item_title, wi.summary AS work_item_summary,
            t.title AS task_title, t.description AS task_description, a.metadata_json
     FROM artifacts a
     LEFT JOIN work_items wi ON wi.id = a.work_item_id
     LEFT JOIN task_work_items twi ON twi.work_item_id = a.work_item_id
     LEFT JOIN tasks t ON t.id = twi.task_id
     WHERE a.app_id = ? AND a.kind = 'pull_request' AND a.work_item_id IS NOT NULL
     ORDER BY a.created_at DESC, a.id DESC`
  ).all(appId) as Array<{
    work_item_id: number;
    work_item_title: string | null;
    work_item_summary: string | null;
    task_title: string | null;
    task_description: string | null;
    metadata_json: string | null;
  }>;
  for (const row of rows) {
    const metadata = parseJson<{ pr_number?: number; pr_url?: string }>(row.metadata_json, {});
    const urlMatches = metadata.pr_url?.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
    const matchesRepo = urlMatches && urlMatches[1].toLowerCase() === owner.toLowerCase()
      && urlMatches[2].toLowerCase() === repo.toLowerCase() && Number(urlMatches[3]) === prNumber;
    if (Number(metadata.pr_number) === prNumber || matchesRepo) {
      return {
        work_item_id: row.work_item_id,
        title: row.task_title || row.work_item_title || "Linked Archie task",
        summary: row.work_item_summary || "",
        acceptance_criteria: row.task_description || "",
      };
    }
  }
  return null;
}

function collectChangedLines(files: GitHubReviewContext["files"]): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const file of files) {
    const lines = new Set<number>();
    let currentLine = 0;
    for (const line of file.patch.split("\n")) {
      const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunk) {
        currentLine = Number(hunk[1]);
        continue;
      }
      if (line.startsWith("+++")) continue;
      if (line.startsWith("+")) lines.add(currentLine);
      if (!line.startsWith("-")) currentLine += 1;
    }
    result.set(file.filename, lines);
  }
  return result;
}

function schemaFieldNames(schema: any, components: any, depth = 0): string[] {
  if (!schema || depth > 2) return [];
  if (schema.$ref && typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").pop();
    return name && components?.schemas?.[name] ? schemaFieldNames(components.schemas[name], components, depth + 1) : [];
  }
  return schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties).slice(0, 80) : [];
}

function securityNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => (
    entry && typeof entry === "object" ? Object.keys(entry as Record<string, unknown>) : []
  )))].slice(0, 40);
}

export function normalizeOpenApiContract(text: string, sourcePath: string, sourceRevision: string): NormalizedOpenApiContract {
  const document = text.trim().startsWith("{") ? JSON.parse(text) : yaml.load(text);
  const root = (document && typeof document === "object") ? document as any : {};
  const endpoints: NormalizedOpenApiContract["endpoints"] = [];
  for (const [pathName, pathItem] of Object.entries(root.paths || {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
      if (!["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(method.toLowerCase())) continue;
      const op = operation as any;
      const parameters = [
        ...(Array.isArray((pathItem as any).parameters) ? (pathItem as any).parameters : []),
        ...(Array.isArray(op.parameters) ? op.parameters : []),
      ].map((parameter: any) => parameter?.name).filter(Boolean).slice(0, 80).map(String);
      const requestSchema = op.requestBody?.content?.["application/json"]?.schema;
      const responseStatuses = Object.keys(op.responses || {}).slice(0, 40);
      const responseFields = responseStatuses.flatMap((status) => schemaFieldNames(
        op.responses?.[status]?.content?.["application/json"]?.schema,
        root.components,
      )).slice(0, 80);
      const errorResponses = responseStatuses
        .filter((status) => status === "default" || !/^2\d\d$/.test(status))
        .map((status) => ({
          status,
          fields: schemaFieldNames(op.responses?.[status]?.content?.["application/json"]?.schema, root.components),
        }));
      endpoints.push({
        path: String(pathName),
        method: method.toUpperCase(),
        operation_id: typeof op.operationId === "string" ? op.operationId : null,
        parameters: [...parameters, ...schemaFieldNames(requestSchema, root.components)].slice(0, 100),
        request_fields: schemaFieldNames(requestSchema, root.components),
        response_statuses: responseStatuses,
        response_fields: responseFields,
        authentication_requirements: securityNames(op.security === undefined ? root.security : op.security),
        error_responses: errorResponses,
      });
    }
  }
  return {
    source_path: sourcePath,
    source_revision: sourceRevision,
    openapi: typeof root.openapi === "string" ? root.openapi : typeof root.swagger === "string" ? root.swagger : null,
    title: typeof root.info?.title === "string" ? root.info.title : null,
    version: typeof root.info?.version === "string" ? root.info.version : null,
    endpoints: endpoints.slice(0, 500),
  };
}

async function loadContracts(appId: number, token: string, warnings: string[]): Promise<ReviewContextPacket["contracts"]> {
  const contracts: ReviewContextPacket["contracts"] = [];
  const settings = getGitHubAppSettings();
  for (const dependency of dal.listProjectDependencies(appId).filter((item) => item.state === "active" && item.contract_type === "openapi")) {
    const providerRepo = dal.getProjectRepositoryForApp(dependency.provider_app_id);
    if (!providerRepo) {
      warnings.push(`dependency ${dependency.id}: provider repository is not mapped`);
      continue;
    }
    try {
      const providerToken = settings.app_id && settings.private_key
        ? (await getGitHubAppInstallationToken(providerRepo.installation_id, providerRepo.repo)).token
        : token;
      const sourceRevision = await getGitHubRefSha({
        owner: providerRepo.owner,
        repo: providerRepo.repo,
        ref: dependency.authoritative_ref,
        token: providerToken,
      });
      const cached = dal.getLatestContractSnapshot(dependency.id, sourceRevision);
      let normalized = cached?.status === "ready" && cached.normalized_json
        ? parseJson<NormalizedOpenApiContract | null>(cached.normalized_json, null)
        : null;
      if (!normalized) {
        const content = await getGitHubFileAtRef({
          owner: providerRepo.owner,
          repo: providerRepo.repo,
          path: dependency.source_path,
          ref: sourceRevision,
          token: providerToken,
        });
        if (content.length > MAX_CONTRACT_LENGTH) {
          throw new Error(`contract exceeds the ${MAX_CONTRACT_LENGTH}-character extraction limit`);
        }
        normalized = normalizeOpenApiContract(content, dependency.source_path, sourceRevision);
        dal.upsertContractSnapshot({
          dependency_id: dependency.id,
          source_revision: sourceRevision,
          source_path: dependency.source_path,
          normalized_json: JSON.stringify(normalized),
          status: "ready",
        });
      }
      if (normalized) {
        contracts.push({
          ...normalized,
          dependency_id: dependency.id,
          provider: `${providerRepo.owner}/${providerRepo.repo}`,
          reference: dependency.authoritative_ref,
        });
      }
    } catch (error) {
      warnings.push(`dependency ${dependency.id}: ${error instanceof Error ? error.message : "contract unavailable"}`);
      const cached = dal.getLatestContractSnapshot(dependency.id);
      if (cached?.status === "ready" && cached.normalized_json) {
        const normalized = parseJson<NormalizedOpenApiContract | null>(cached.normalized_json, null);
        if (normalized) contracts.push({ ...normalized, dependency_id: dependency.id, provider: dependency.provider_name || "unknown", reference: dependency.authoritative_ref });
      }
    }
  }
  return contracts;
}

export async function buildReviewContext(params: {
  review: PullRequestReviewRow;
  worktreeDir: string;
  token: string;
  localChecks: Array<Record<string, unknown>>;
}): Promise<ReviewContextPacket> {
  const { review, worktreeDir, token, localChecks } = params;
  if (!review.base_sha || !review.head_sha) throw new Error("Review is missing base or head SHA.");
  const github = await loadGitHubReviewContext({ owner: review.owner, repo: review.repo, prNumber: review.pr_number, token });
  const warnings = [...github.warnings];
  const task = findLinkedTask(review.app_id, review.owner, review.repo, review.pr_number);
  const policyResult = resolveReviewPolicy(dal.getReviewPolicyLayers(review.app_id, review.owner, review.repo));
  const contracts = await loadContracts(review.app_id, token, warnings);
  const previousReview = review.previous_review_id
    ? dal.getPullRequestReview(review.previous_review_id)
    : dal.getPreviousCompletedReview(review);
  const comparisonSha = review.review_mode === "full"
    ? review.base_sha
    : (previousReview?.status === "completed" && previousReview.head_sha ? previousReview.head_sha : review.base_sha);
  const localDiff = gitDiff(worktreeDir, comparisonSha, review.head_sha);
  const files = localDiff === null ? github.files : filesFromLocalDiff(localDiff, github.files);
  const affectedPaths = new Set(files.map((file) => file.filename));
  const previousFindings = previousReview
    ? dal.listReviewFindings(previousReview.id)
      .filter((finding) => affectedPaths.has(finding.path))
      .slice(0, 100)
      .map((finding) => ({
        id: finding.id,
        path: finding.path,
        line: finding.line,
        end_line: finding.end_line,
        title: finding.title,
        body: finding.body,
        status: finding.status,
        evidence: parseJson(finding.evidence_json, {}),
      }))
    : [];
  const sources = ["github_pull_request", "github_changed_files", "github_diff", "github_checks", "isolated_worktree", "local_checks"];
  if (task) sources.push("archie_task");
  if (policyResult.revision !== "default-v1") sources.push("review_policy");
  if (contracts.length) sources.push("approved_dependency_contracts");
  if (previousFindings.length) sources.push("previous_archie_findings");
  return {
    review: {
      id: review.id,
      owner: review.owner,
      repo: review.repo,
      number: review.pr_number,
      base_sha: review.base_sha,
      head_sha: review.head_sha,
      comparison_sha: comparisonSha,
      mode: review.review_mode,
    },
    pull_request: github.pull_request,
    diff: localDiff ?? github.diff,
    files,
    publication_files: github.files,
    checks: github.checks,
    comments: { issue: github.issue_comments, review: github.review_comments, submitted_reviews: github.reviews },
    local_checks: localChecks,
    task,
    policy: policyResult.policy,
    policy_revision: policyResult.revision,
    contracts,
    previous_findings: previousFindings,
    warnings,
    sources,
  };
}

export function changedLinesForContext(context: ReviewContextPacket): Map<string, Set<number>> {
  return collectChangedLines(context.files);
}

export function publishableChangedLinesForContext(context: ReviewContextPacket): Map<string, Set<number>> {
  return collectChangedLines(context.publication_files || context.files);
}

export function contextDisclosure(context: ReviewContextPacket): string {
  const parts = context.sources.map((source) => source.replace(/_/g, " "));
  const contractText = context.contracts.length
    ? ` Checked approved OpenAPI contract${context.contracts.length === 1 ? "" : "s"}: ${context.contracts.map((contract) => `${contract.provider}/${contract.source_path}@${contract.reference}`).join(", ")}.`
    : " No approved dependency contract was checked.";
  return `Context used: ${parts.join(", ")}.${contractText}`;
}
