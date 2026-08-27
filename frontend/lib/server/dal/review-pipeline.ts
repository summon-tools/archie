import crypto from "crypto";
import { getDb } from "../db";
import type {
  ContractSnapshotRow,
  ProjectDependencyRow,
  PullRequestReviewRow,
  ReviewFindingRow,
  ReviewPolicyRow,
  ReviewThreadInteractionRow,
} from "../types";

const POLICY_SELECT = "SELECT * FROM review_policies";
const DEPENDENCY_SELECT = `
  SELECT d.*, provider.name AS provider_name, provider.directory AS provider_directory,
         provider.github_repo AS provider_github_repo
  FROM project_dependencies d
  JOIN apps provider ON provider.id = d.provider_app_id
`;

export function getReviewPolicyForRepository(appId: number, owner: string, repo: string): ReviewPolicyRow | undefined {
  const db = getDb();
  return db.prepare(
    `${POLICY_SELECT}
     WHERE app_id = ? AND state = 'active'
       AND ((lower(owner) = lower(?) AND lower(repo) = lower(?)) OR (owner IS NULL AND repo IS NULL))
     ORDER BY CASE WHEN owner IS NULL THEN 1 ELSE 0 END, id DESC LIMIT 1`
  ).get(appId, owner, repo) as ReviewPolicyRow | undefined;
}

export function getReviewPolicyLayers(appId: number, owner: string, repo: string): {
  company: ReviewPolicyRow | undefined;
  repository: ReviewPolicyRow | undefined;
} {
  const db = getDb();
  const company = db.prepare(
    `${POLICY_SELECT}
     WHERE app_id = ? AND state = 'active' AND owner IS NULL AND repo IS NULL
     ORDER BY id DESC LIMIT 1`
  ).get(appId) as ReviewPolicyRow | undefined;
  const repository = owner && repo ? db.prepare(
    `${POLICY_SELECT}
     WHERE app_id = ? AND state = 'active' AND lower(owner) = lower(?) AND lower(repo) = lower(?)
     ORDER BY id DESC LIMIT 1`
  ).get(appId, owner, repo) as ReviewPolicyRow | undefined : undefined;
  return { company, repository };
}

export function createReviewPolicy(data: {
  app_id: number;
  owner?: string | null;
  repo?: string | null;
  revision: string;
  policy_json: string;
}): ReviewPolicyRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO review_policies (app_id, owner, repo, revision, policy_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(data.app_id, data.owner ?? null, data.repo ?? null, data.revision, data.policy_json);
  return db.prepare(`${POLICY_SELECT} WHERE id = ?`).get(Number(result.lastInsertRowid)) as ReviewPolicyRow;
}

export function archiveReviewPolicies(appId: number, owner?: string | null, repo?: string | null): void {
  if (owner && repo) {
    getDb().prepare(
      `UPDATE review_policies SET state = 'archived'
       WHERE app_id = ? AND lower(owner) = lower(?) AND lower(repo) = lower(?)`
    ).run(appId, owner, repo);
    return;
  }
  getDb().prepare(
    "UPDATE review_policies SET state = 'archived' WHERE app_id = ? AND owner IS NULL AND repo IS NULL"
  ).run(appId);
}

export function listProjectDependencies(appId: number): ProjectDependencyRow[] {
  return getDb().prepare(
    `${DEPENDENCY_SELECT} WHERE d.consumer_app_id = ? ORDER BY d.id ASC`
  ).all(appId) as ProjectDependencyRow[];
}

export function getProjectDependency(id: number): ProjectDependencyRow | undefined {
  return getDb().prepare(`${DEPENDENCY_SELECT} WHERE d.id = ?`).get(id) as ProjectDependencyRow | undefined;
}

export function createProjectDependency(data: {
  consumer_app_id: number;
  provider_app_id: number;
  relationship_type?: string;
  authoritative_ref?: string;
  contract_type?: string;
  source_path: string;
  version_expectation?: string | null;
}): ProjectDependencyRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO project_dependencies (
      consumer_app_id, provider_app_id, relationship_type, authoritative_ref,
      contract_type, source_path, version_expectation
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.consumer_app_id,
    data.provider_app_id,
    data.relationship_type || "consumes_api",
    data.authoritative_ref?.trim() || "main",
    data.contract_type || "openapi",
    data.source_path.trim(),
    data.version_expectation ?? null,
  );
  return getProjectDependency(Number(result.lastInsertRowid))!;
}

export function updateProjectDependency(id: number, fields: Partial<Pick<ProjectDependencyRow, "relationship_type" | "authoritative_ref" | "contract_type" | "source_path" | "version_expectation" | "state">>): ProjectDependencyRow | undefined {
  const allowed = ["relationship_type", "authoritative_ref", "contract_type", "source_path", "version_expectation", "state"] as const;
  const values: unknown[] = [];
  const setParts: string[] = [];
  for (const field of allowed) {
    if (fields[field] !== undefined) {
      setParts.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  if (setParts.length) {
    setParts.push("updated_at = datetime('now')");
    values.push(id);
    getDb().prepare(`UPDATE project_dependencies SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
  }
  return getProjectDependency(id);
}

export function deleteProjectDependency(id: number): boolean {
  return getDb().prepare("DELETE FROM project_dependencies WHERE id = ?").run(id).changes > 0;
}

export function getLatestContractSnapshot(dependencyId: number, sourceRevision?: string): ContractSnapshotRow | undefined {
  const db = getDb();
  if (sourceRevision) {
    return db.prepare(
      "SELECT * FROM contract_snapshots WHERE dependency_id = ? AND source_revision = ? ORDER BY id DESC LIMIT 1"
    ).get(dependencyId, sourceRevision) as ContractSnapshotRow | undefined;
  }
  return db.prepare(
    "SELECT * FROM contract_snapshots WHERE dependency_id = ? ORDER BY fetched_at DESC, id DESC LIMIT 1"
  ).get(dependencyId) as ContractSnapshotRow | undefined;
}

export function upsertContractSnapshot(data: {
  dependency_id: number;
  source_revision: string;
  source_path: string;
  normalized_json?: string | null;
  status: "ready" | "fetching" | "failed";
  error_text?: string | null;
}): ContractSnapshotRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO contract_snapshots (
      dependency_id, source_revision, source_path, normalized_json, status, error_text, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(dependency_id, source_revision) DO UPDATE SET
      source_path = excluded.source_path,
      normalized_json = excluded.normalized_json,
      status = excluded.status,
      error_text = excluded.error_text,
      fetched_at = datetime('now')`
  ).run(
    data.dependency_id,
    data.source_revision,
    data.source_path,
    data.normalized_json ?? null,
    data.status,
    data.error_text ?? null,
  );
  return getLatestContractSnapshot(data.dependency_id, data.source_revision)!;
}

export function getPreviousCompletedReview(review: PullRequestReviewRow): PullRequestReviewRow | undefined {
  return getDb().prepare(
    `SELECT * FROM pull_request_reviews
     WHERE lower(owner) = lower(?) AND lower(repo) = lower(?) AND pr_number = ?
       AND status = 'completed' AND id < ?
     ORDER BY id DESC LIMIT 1`
  ).get(review.owner, review.repo, review.pr_number, review.id) as PullRequestReviewRow | undefined;
}

export function getLatestCompletedPullRequestReview(owner: string, repo: string, prNumber: number): PullRequestReviewRow | undefined {
  return getDb().prepare(
    `SELECT * FROM pull_request_reviews
     WHERE lower(owner) = lower(?) AND lower(repo) = lower(?) AND pr_number = ?
       AND status = 'completed'
     ORDER BY id DESC LIMIT 1`
  ).get(owner, repo, prNumber) as PullRequestReviewRow | undefined;
}

export function createReviewFinding(data: {
  review_id: number;
  path: string;
  line: number;
  end_line?: number | null;
  side?: "LEFT" | "RIGHT";
  start_side?: "LEFT" | "RIGHT" | null;
  title: string;
  body: string;
  severity?: string;
  evidence_json: string;
}): ReviewFindingRow {
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify([
    data.path, data.line, data.end_line ?? null, data.title.trim(), data.body.trim(),
  ])).digest("hex");
  const db = getDb();
  db.prepare(
    `INSERT INTO review_findings (
      review_id, fingerprint, path, line, end_line, side, start_side, title, body, severity, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(review_id, fingerprint) DO UPDATE SET
      path = excluded.path, line = excluded.line, end_line = excluded.end_line,
      side = excluded.side, start_side = excluded.start_side, title = excluded.title,
      body = excluded.body, severity = excluded.severity, evidence_json = excluded.evidence_json,
      updated_at = datetime('now')`
  ).run(
    data.review_id,
    fingerprint,
    data.path,
    data.line,
    data.end_line ?? null,
    data.side || "RIGHT",
    data.start_side ?? null,
    data.title.trim(),
    data.body.trim(),
    data.severity || "advisory",
    data.evidence_json,
  );
  return db.prepare("SELECT * FROM review_findings WHERE review_id = ? AND fingerprint = ?").get(data.review_id, fingerprint) as ReviewFindingRow;
}

export function listReviewFindings(reviewId: number): ReviewFindingRow[] {
  return getDb().prepare("SELECT * FROM review_findings WHERE review_id = ? ORDER BY line ASC, id ASC").all(reviewId) as ReviewFindingRow[];
}

export function updateReviewFinding(id: number, fields: Partial<Pick<ReviewFindingRow, "status" | "github_comment_id" | "github_comment_url" | "resolution_json">>): ReviewFindingRow | undefined {
  const allowed = ["status", "github_comment_id", "github_comment_url", "resolution_json"] as const;
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const field of allowed) {
    if (fields[field] !== undefined) {
      setParts.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  if (setParts.length) {
    setParts.push("updated_at = datetime('now')");
    values.push(id);
    getDb().prepare(`UPDATE review_findings SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
  }
  return getDb().prepare("SELECT * FROM review_findings WHERE id = ?").get(id) as ReviewFindingRow | undefined;
}

export function createReviewThreadInteraction(data: {
  review_id: number;
  github_comment_id: number;
  author_login?: string | null;
  mention_text: string;
  raw_json?: string | null;
}): ReviewThreadInteractionRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO review_thread_interactions (
      review_id, github_comment_id, author_login, mention_text, raw_json
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(github_comment_id) DO UPDATE SET updated_at = datetime('now')`
  ).run(data.review_id, data.github_comment_id, data.author_login ?? null, data.mention_text, data.raw_json ?? null);
  return db.prepare("SELECT * FROM review_thread_interactions WHERE github_comment_id = ?").get(data.github_comment_id) as ReviewThreadInteractionRow;
}

export function updateReviewThreadInteraction(id: number, fields: Partial<Pick<ReviewThreadInteractionRow, "response_body" | "disposition" | "status" | "model_usage_json">>): ReviewThreadInteractionRow | undefined {
  const allowed = ["response_body", "disposition", "status", "model_usage_json"] as const;
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const field of allowed) {
    if (fields[field] !== undefined) {
      setParts.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  if (setParts.length) {
    setParts.push("updated_at = datetime('now')");
    values.push(id);
    getDb().prepare(`UPDATE review_thread_interactions SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
  }
  return getDb().prepare("SELECT * FROM review_thread_interactions WHERE id = ?").get(id) as ReviewThreadInteractionRow | undefined;
}

export function getReviewThreadInteractionByCommentId(commentId: number): ReviewThreadInteractionRow | undefined {
  return getDb().prepare("SELECT * FROM review_thread_interactions WHERE github_comment_id = ?").get(commentId) as ReviewThreadInteractionRow | undefined;
}

export function claimReviewThreadInteraction(commentId: number, staleMinutes = 30): ReviewThreadInteractionRow | undefined {
  const safeMinutes = Math.max(1, Math.min(240, Math.floor(staleMinutes)));
  const db = getDb();
  const result = db.prepare(
    `UPDATE review_thread_interactions
     SET processing_started_at = datetime('now'), updated_at = datetime('now')
     WHERE github_comment_id = ? AND status = 'queued'
       AND (processing_started_at IS NULL OR processing_started_at < datetime('now', ?))`
  ).run(commentId, `-${safeMinutes} minutes`);
  return result.changes > 0 ? getReviewThreadInteractionByCommentId(commentId) : undefined;
}

export function listRecoverableReviewThreadInteractions(staleMinutes = 30): ReviewThreadInteractionRow[] {
  const safeMinutes = Math.max(1, Math.min(240, Math.floor(staleMinutes)));
  return getDb().prepare(
    `SELECT * FROM review_thread_interactions
     WHERE status = 'queued'
       AND (processing_started_at IS NULL OR processing_started_at < datetime('now', ?))
     ORDER BY id ASC`
  ).all(`-${safeMinutes} minutes`) as ReviewThreadInteractionRow[];
}

export function getReviewFindingByGitHubCommentId(commentId: number): ReviewFindingRow | undefined {
  return getDb().prepare(
    "SELECT * FROM review_findings WHERE github_comment_id = ? ORDER BY id DESC LIMIT 1"
  ).get(commentId) as ReviewFindingRow | undefined;
}

export function getReviewFindingForLocation(
  reviewId: number,
  path: string,
  line: number,
  title?: string | null,
): ReviewFindingRow | undefined {
  const db = getDb();
  if (title) {
    const titled = db.prepare(
      `SELECT * FROM review_findings
       WHERE review_id = ? AND path = ? AND line = ? AND lower(title) = lower(?)
       ORDER BY id DESC LIMIT 1`
    ).get(reviewId, path, line, title) as ReviewFindingRow | undefined;
    if (titled) return titled;
  }
  return db.prepare(
    `SELECT * FROM review_findings
     WHERE review_id = ? AND path = ? AND line = ?
     ORDER BY id DESC LIMIT 1`
  ).get(reviewId, path, line) as ReviewFindingRow | undefined;
}
