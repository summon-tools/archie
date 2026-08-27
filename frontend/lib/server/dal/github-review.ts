import crypto from "crypto";
import { getDb } from "../db";
import type {
  GitHubInstallationRow,
  GitHubWebhookEventRow,
  ProjectRepositoryRow,
  PullRequestReviewRow,
} from "../types";

const PROJECT_REPOSITORY_SELECT = `
  SELECT
    pr.*,
    a.name AS app_name
  FROM project_repositories pr
  JOIN apps a ON a.id = pr.app_id
`;

export function upsertGitHubInstallation(data: {
  installation_id: number;
  account_login: string;
  account_type?: string | null;
  repository_selection?: string | null;
  raw_json?: string | null;
}): GitHubInstallationRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO github_installations (
      installation_id, account_login, account_type, repository_selection, raw_json, state, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
    ON CONFLICT(installation_id) DO UPDATE SET
      account_login = excluded.account_login,
      account_type = excluded.account_type,
      repository_selection = excluded.repository_selection,
      raw_json = excluded.raw_json,
      state = 'active',
      updated_at = datetime('now')`
  ).run(
    data.installation_id,
    data.account_login,
    data.account_type ?? null,
    data.repository_selection ?? null,
    data.raw_json ?? null,
  );
  return getGitHubInstallation(data.installation_id)!;
}

export function getGitHubInstallation(installationId: number): GitHubInstallationRow | undefined {
  return getDb()
    .prepare("SELECT * FROM github_installations WHERE installation_id = ?")
    .get(installationId) as GitHubInstallationRow | undefined;
}

export function listProjectRepositories(): ProjectRepositoryRow[] {
  return getDb()
    .prepare(`${PROJECT_REPOSITORY_SELECT} ORDER BY CASE WHEN pr.state = 'active' THEN 0 ELSE 1 END, pr.updated_at DESC, pr.id DESC`)
    .all() as ProjectRepositoryRow[];
}

export function getProjectRepository(owner: string, repo: string): ProjectRepositoryRow | undefined {
  return getDb()
    .prepare(`${PROJECT_REPOSITORY_SELECT} WHERE lower(pr.owner) = lower(?) AND lower(pr.repo) = lower(?)`)
    .get(owner, repo) as ProjectRepositoryRow | undefined;
}

export function getProjectRepositoryForApp(appId: number): ProjectRepositoryRow | undefined {
  return getDb()
    .prepare(`${PROJECT_REPOSITORY_SELECT} WHERE pr.app_id = ? AND pr.state = 'active' ORDER BY pr.updated_at DESC, pr.id DESC LIMIT 1`)
    .get(appId) as ProjectRepositoryRow | undefined;
}

export function upsertProjectRepository(data: {
  app_id: number;
  installation_id: number;
  owner: string;
  repo: string;
  default_branch?: string;
  raw_json?: string | null;
}): ProjectRepositoryRow {
  const db = getDb();
  const owner = data.owner.trim().toLowerCase();
  const repo = data.repo.trim().toLowerCase();
  db.transaction(() => {
    db.prepare(
      `UPDATE project_repositories
       SET state = 'paused', updated_at = datetime('now')
       WHERE app_id = ? AND state = 'active'
         AND NOT (lower(owner) = lower(?) AND lower(repo) = lower(?))`
    ).run(data.app_id, owner, repo);
    const existing = db.prepare(
      "SELECT id FROM project_repositories WHERE lower(owner) = lower(?) AND lower(repo) = lower(?) ORDER BY id DESC LIMIT 1"
    ).get(owner, repo) as { id: number } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE project_repositories
         SET app_id = ?, installation_id = ?, owner = ?, repo = ?, default_branch = ?,
             state = 'active', raw_json = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        data.app_id,
        data.installation_id,
        owner,
        repo,
        data.default_branch?.trim() || "main",
        data.raw_json ?? null,
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO project_repositories (
          app_id, installation_id, owner, repo, default_branch, state, raw_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, datetime('now'))`
      ).run(
        data.app_id,
        data.installation_id,
        owner,
        repo,
        data.default_branch?.trim() || "main",
        data.raw_json ?? null,
      );
    }
  })();
  return getProjectRepository(owner, repo)!;
}

export interface QueuePullRequestReviewInput {
  delivery_id: string;
  event_name: string;
  action: string | null;
  installation_id: number | null;
  owner: string | null;
  repo: string | null;
  pr_number: number | null;
  base_sha: string | null;
  head_sha: string | null;
  requested_reviewer_login: string | null;
  payload_json: string;
  review_mode?: "targeted" | "full";
  previous_review_id?: number | null;
}

export interface QueuePullRequestReviewResult {
  duplicate: boolean;
  event: GitHubWebhookEventRow;
  review: PullRequestReviewRow | undefined;
  reason: string | null;
}

export function recordGitHubWebhookReceipt(data: {
  delivery_id: string;
  event_name: string;
  action?: string | null;
  installation_id?: number | null;
  owner?: string | null;
  repo?: string | null;
  head_sha?: string | null;
  payload_json: string;
}): boolean {
  const result = getDb().prepare(
    `INSERT OR IGNORE INTO github_webhook_events (
      delivery_id, event_name, action, installation_id, owner, repo, head_sha, status, payload_json, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, datetime('now'))`
  ).run(
    data.delivery_id,
    data.event_name,
    data.action ?? null,
    data.installation_id ?? null,
    data.owner ?? null,
    data.repo ?? null,
    data.head_sha ?? null,
    data.payload_json,
  );
  return result.changes > 0;
}

export function queuePullRequestReviewFromWebhook(
  input: QueuePullRequestReviewInput,
): QueuePullRequestReviewResult {
  const db = getDb();
  const result = db.transaction(() => {
    const existing = db.prepare(
      "SELECT * FROM github_webhook_events WHERE delivery_id = ?"
    ).get(input.delivery_id) as GitHubWebhookEventRow | undefined;
    if (existing) {
      return {
        duplicate: true,
        event: existing,
        review: existing.review_id
          ? db.prepare("SELECT * FROM pull_request_reviews WHERE id = ?").get(existing.review_id) as PullRequestReviewRow | undefined
          : undefined,
        reason: existing.error_text,
      };
    }

    const insertEvent = db.prepare(
      `INSERT INTO github_webhook_events (
        delivery_id, event_name, action, installation_id, owner, repo, head_sha, status, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?)`
    );
    const eventInsert = insertEvent.run(
      input.delivery_id,
      input.event_name,
      input.action,
      input.installation_id,
      input.owner,
      input.repo,
      input.head_sha,
      input.payload_json,
    );
    const eventId = Number(eventInsert.lastInsertRowid);

    let reason: string | null = null;
    let reviewId: number | null = null;
    const repository = input.owner && input.repo
      ? db.prepare(`${PROJECT_REPOSITORY_SELECT} WHERE lower(pr.owner) = lower(?) AND lower(pr.repo) = lower(?)`)
        .get(input.owner, input.repo) as ProjectRepositoryRow | undefined
      : undefined;

    const isReviewCommand = input.event_name === "issue_comment" && input.action === "review_command";
    const reviewMode = input.review_mode || "targeted";

    if (!isReviewCommand) {
      reason = input.event_name === "pull_request" && input.action === "synchronize"
        ? "new_head_available"
        : "event_not_supported";
    } else if (!input.installation_id) {
      reason = "installation_missing";
    } else if (!input.owner || !input.repo || !repository) {
      reason = "repository_not_mapped";
    } else if (repository.state !== "active") {
      reason = "repository_mapping_paused";
    } else if (repository.installation_id !== input.installation_id) {
      reason = "installation_mismatch";
    } else if (!input.pr_number || !input.base_sha || !input.head_sha) {
      reason = "pull_request_identity_incomplete";
    } else {
      const existingReview = db.prepare(
        `SELECT * FROM pull_request_reviews
         WHERE lower(owner) = lower(?) AND lower(repo) = lower(?)
           AND pr_number = ? AND head_sha = ? AND action = ? AND review_mode = ?
         ORDER BY id DESC LIMIT 1`
      ).get(input.owner, input.repo, input.pr_number, input.head_sha, input.action, reviewMode) as PullRequestReviewRow | undefined;
      if (existingReview) {
        reviewId = existingReview.id;
        reason = "review_already_queued_for_head";
      } else {
        const reviewInsert = db.prepare(
          `INSERT INTO pull_request_reviews (
            app_id, installation_id, owner, repo, pr_number, action,
            base_sha, head_sha, requested_reviewer_login, status, review_mode,
            previous_review_id, trigger_delivery_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
        ).run(
          repository.app_id,
          input.installation_id,
          input.owner,
          input.repo,
          input.pr_number,
          input.action,
          input.base_sha,
          input.head_sha,
          input.requested_reviewer_login,
          reviewMode,
          input.previous_review_id ?? null,
          input.delivery_id,
        );
        reviewId = Number(reviewInsert.lastInsertRowid);
      }
    }

    db.prepare(
      `UPDATE github_webhook_events
       SET status = ?, review_id = ?, error_text = ?, processed_at = datetime('now')
       WHERE id = ?`
    ).run(reviewId ? "queued" : "ignored", reviewId, reason, eventId);

    const event = db.prepare("SELECT * FROM github_webhook_events WHERE id = ?").get(eventId) as GitHubWebhookEventRow;
    const review = reviewId
      ? db.prepare("SELECT * FROM pull_request_reviews WHERE id = ?").get(reviewId) as PullRequestReviewRow
      : undefined;
    return { duplicate: false, event, review, reason };
  })();

  return result;
}

export function getPullRequestReview(reviewId: number): PullRequestReviewRow | undefined {
  return getDb()
    .prepare("SELECT * FROM pull_request_reviews WHERE id = ?")
    .get(reviewId) as PullRequestReviewRow | undefined;
}

export function getLatestPullRequestReview(owner: string, repo: string, prNumber: number): PullRequestReviewRow | undefined {
  return getDb().prepare(
    `SELECT * FROM pull_request_reviews
     WHERE lower(owner) = lower(?) AND lower(repo) = lower(?) AND pr_number = ?
     ORDER BY id DESC LIMIT 1`
  ).get(owner, repo, prNumber) as PullRequestReviewRow | undefined;
}

export function getPullRequestReviewByGitHubReviewId(githubReviewId: number): PullRequestReviewRow | undefined {
  return getDb().prepare("SELECT * FROM pull_request_reviews WHERE github_review_id = ? ORDER BY id DESC LIMIT 1").get(githubReviewId) as PullRequestReviewRow | undefined;
}

export function queueManualPullRequestReview(review: PullRequestReviewRow, mode: "targeted" | "full"): PullRequestReviewRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO pull_request_reviews (
      app_id, installation_id, owner, repo, pr_number, action, base_sha, head_sha,
      requested_reviewer_login, status, review_mode, previous_review_id, trigger_delivery_id
    ) VALUES (?, ?, ?, ?, ?, 'manual_rerun', ?, ?, ?, 'queued', ?, ?, ?)`
  ).run(
    review.app_id,
    review.installation_id,
    review.owner,
    review.repo,
    review.pr_number,
    review.base_sha,
    review.head_sha,
    review.requested_reviewer_login,
    mode,
    review.id,
    `manual-${crypto.randomUUID()}`,
  );
  return getPullRequestReview(Number(result.lastInsertRowid))!;
}

export function updatePullRequestReview(
  reviewId: number,
  fields: Partial<Pick<PullRequestReviewRow,
    "status" | "execution_mode" | "workspace_path" | "execution_json" | "context_sources_json" |
    "comparison_sha" | "policy_revision" | "model_usage_json" | "pr_url" | "pr_title" | "pr_body" |
    "context_packet_json" | "publication_json" | "github_review_id" | "provider_id" | "model_id" |
    "review_mode" | "previous_review_id" | "completed_at" | "error_text"
  >>,
): PullRequestReviewRow | undefined {
  const allowedFields = [
    "status",
    "execution_mode",
    "workspace_path",
    "execution_json",
    "context_sources_json",
    "comparison_sha",
    "policy_revision",
    "model_usage_json",
    "pr_url",
    "pr_title",
    "pr_body",
    "context_packet_json",
    "publication_json",
    "github_review_id",
    "provider_id",
    "model_id",
    "review_mode",
    "previous_review_id",
    "completed_at",
    "error_text",
  ] as const;
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const field of allowedFields) {
    if (fields[field] !== undefined) {
      setParts.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  if (setParts.length > 0) {
    setParts.push("updated_at = datetime('now')");
    values.push(reviewId);
    getDb().prepare(`UPDATE pull_request_reviews SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
  }
  return getPullRequestReview(reviewId);
}

export function claimPullRequestReview(reviewId: number, staleMinutes = 10): boolean {
  const safeMinutes = Math.max(1, Math.min(240, Math.floor(staleMinutes)));
  const result = getDb().prepare(
    `UPDATE pull_request_reviews
     SET status = 'running', updated_at = datetime('now')
     WHERE id = ? AND (
       status = 'queued'
       OR (status = 'running' AND updated_at < datetime('now', ?))
     )`
  ).run(reviewId, `-${safeMinutes} minutes`);
  return result.changes > 0;
}

export function touchPullRequestReview(reviewId: number): boolean {
  return getDb().prepare(
    "UPDATE pull_request_reviews SET updated_at = datetime('now') WHERE id = ? AND status = 'running'"
  ).run(reviewId).changes > 0;
}

export function listRecoverablePullRequestReviews(staleMinutes = 10): PullRequestReviewRow[] {
  const safeMinutes = Math.max(1, Math.min(240, Math.floor(staleMinutes)));
  return getDb().prepare(
    `SELECT * FROM pull_request_reviews
     WHERE status = 'queued'
        OR (status = 'running' AND updated_at < datetime('now', ?))
     ORDER BY id ASC`
  ).all(`-${safeMinutes} minutes`) as PullRequestReviewRow[];
}

export function listActivePullRequestReviewsForApp(appId: number): PullRequestReviewRow[] {
  return getDb().prepare(
    `SELECT * FROM pull_request_reviews
     WHERE app_id = ? AND status IN ('queued', 'running')
     ORDER BY id ASC`
  ).all(appId) as PullRequestReviewRow[];
}
