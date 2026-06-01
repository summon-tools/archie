import { getDb } from "../db";
import type { GitHubOutcomeSyncRunRow, GitHubPrSnapshotRow } from "../types";

export interface UpsertGitHubPrSnapshotInput {
  app_id: number;
  work_item_id: number;
  owner: string;
  repo: string;
  pr_number: number;
  pr_url: string;
  title?: string | null;
  state: string;
  author_login?: string | null;
  head_ref?: string | null;
  base_ref?: string | null;
  merged_at?: string | null;
  closed_at?: string | null;
  github_created_at?: string | null;
  github_updated_at?: string | null;
  additions?: number | null;
  deletions?: number | null;
  changed_files?: number | null;
  commits_count?: number | null;
  issue_comments_count?: number | null;
  review_comments_count?: number | null;
  reviews_count?: number | null;
  raw_json?: string | null;
}

export interface ReplaceGitHubPrEvidenceInput {
  snapshot: UpsertGitHubPrSnapshotInput;
  issue_comments: Array<Record<string, any>>;
  review_comments: Array<Record<string, any>>;
  reviews: Array<Record<string, any>>;
  commits: Array<Record<string, any>>;
}

export function createGitHubOutcomeSyncRun(data: {
  requested_by_user_id?: number | null;
  mode: "manual" | "scheduled";
  range_start?: string | null;
  range_end?: string | null;
}): GitHubOutcomeSyncRunRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO github_outcome_sync_runs (requested_by_user_id, mode, range_start, range_end)
     VALUES (?, ?, ?, ?)`
  ).run(data.requested_by_user_id ?? null, data.mode, data.range_start ?? null, data.range_end ?? null);
  return getGitHubOutcomeSyncRun(Number(result.lastInsertRowid))!;
}

export function updateGitHubOutcomeSyncRun(
  id: number,
  fields: {
    status?: "running" | "completed" | "failed";
    scanned_count?: number;
    synced_count?: number;
    failed_count?: number;
    warnings?: string[];
    error_text?: string | null;
    completed_at?: string | null;
  },
): GitHubOutcomeSyncRunRow {
  const setParts: string[] = [];
  const values: unknown[] = [];
  if (fields.status !== undefined) {
    setParts.push("status = ?");
    values.push(fields.status);
  }
  if (fields.scanned_count !== undefined) {
    setParts.push("scanned_count = ?");
    values.push(fields.scanned_count);
  }
  if (fields.synced_count !== undefined) {
    setParts.push("synced_count = ?");
    values.push(fields.synced_count);
  }
  if (fields.failed_count !== undefined) {
    setParts.push("failed_count = ?");
    values.push(fields.failed_count);
  }
  if (fields.warnings !== undefined) {
    setParts.push("warnings_json = ?");
    values.push(JSON.stringify(fields.warnings));
  }
  if (fields.error_text !== undefined) {
    setParts.push("error_text = ?");
    values.push(fields.error_text);
  }
  if (fields.completed_at !== undefined) {
    setParts.push("completed_at = ?");
    values.push(fields.completed_at);
  }
  if (setParts.length === 0) return getGitHubOutcomeSyncRun(id)!;
  values.push(id);
  getDb().prepare(`UPDATE github_outcome_sync_runs SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
  return getGitHubOutcomeSyncRun(id)!;
}

export function getGitHubOutcomeSyncRun(id: number): GitHubOutcomeSyncRunRow | undefined {
  return getDb().prepare("SELECT * FROM github_outcome_sync_runs WHERE id = ?").get(id) as GitHubOutcomeSyncRunRow | undefined;
}

export function getLatestGitHubOutcomeSyncRun(): GitHubOutcomeSyncRunRow | undefined {
  return getDb()
    .prepare("SELECT * FROM github_outcome_sync_runs ORDER BY started_at DESC, id DESC LIMIT 1")
    .get() as GitHubOutcomeSyncRunRow | undefined;
}

export function getGitHubPrSnapshotForWorkItem(workItemId: number): GitHubPrSnapshotRow | undefined {
  return getDb()
    .prepare("SELECT * FROM github_pr_snapshots WHERE work_item_id = ? ORDER BY synced_at DESC, id DESC LIMIT 1")
    .get(workItemId) as GitHubPrSnapshotRow | undefined;
}

export function replaceGitHubPrEvidence(input: ReplaceGitHubPrEvidenceInput): GitHubPrSnapshotRow {
  const db = getDb();
  const now = new Date().toISOString();
  const snapshot = input.snapshot;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO github_pr_snapshots (
        app_id, work_item_id, owner, repo, pr_number, pr_url, title, state, author_login,
        head_ref, base_ref, merged_at, closed_at, github_created_at, github_updated_at,
        additions, deletions, changed_files, commits_count, issue_comments_count,
        review_comments_count, reviews_count, raw_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner, repo, pr_number) DO UPDATE SET
        app_id = excluded.app_id,
        work_item_id = excluded.work_item_id,
        pr_url = excluded.pr_url,
        title = excluded.title,
        state = excluded.state,
        author_login = excluded.author_login,
        head_ref = excluded.head_ref,
        base_ref = excluded.base_ref,
        merged_at = excluded.merged_at,
        closed_at = excluded.closed_at,
        github_created_at = excluded.github_created_at,
        github_updated_at = excluded.github_updated_at,
        additions = excluded.additions,
        deletions = excluded.deletions,
        changed_files = excluded.changed_files,
        commits_count = excluded.commits_count,
        issue_comments_count = excluded.issue_comments_count,
        review_comments_count = excluded.review_comments_count,
        reviews_count = excluded.reviews_count,
        raw_json = excluded.raw_json,
        synced_at = excluded.synced_at`
    ).run(
      snapshot.app_id,
      snapshot.work_item_id,
      snapshot.owner,
      snapshot.repo,
      snapshot.pr_number,
      snapshot.pr_url,
      snapshot.title ?? "",
      snapshot.state,
      snapshot.author_login ?? null,
      snapshot.head_ref ?? null,
      snapshot.base_ref ?? null,
      snapshot.merged_at ?? null,
      snapshot.closed_at ?? null,
      snapshot.github_created_at ?? null,
      snapshot.github_updated_at ?? null,
      snapshot.additions ?? null,
      snapshot.deletions ?? null,
      snapshot.changed_files ?? null,
      snapshot.commits_count ?? null,
      snapshot.issue_comments_count ?? null,
      snapshot.review_comments_count ?? null,
      snapshot.reviews_count ?? null,
      snapshot.raw_json ?? null,
      now,
    );

    const row = db.prepare(
      "SELECT * FROM github_pr_snapshots WHERE owner = ? AND repo = ? AND pr_number = ?"
    ).get(snapshot.owner, snapshot.repo, snapshot.pr_number) as GitHubPrSnapshotRow;

    db.prepare("DELETE FROM github_pr_comments WHERE pr_snapshot_id = ?").run(row.id);
    db.prepare("DELETE FROM github_pr_reviews WHERE pr_snapshot_id = ?").run(row.id);
    db.prepare("DELETE FROM github_pr_commits WHERE pr_snapshot_id = ?").run(row.id);

    const insertComment = db.prepare(
      `INSERT OR REPLACE INTO github_pr_comments (
        pr_snapshot_id, app_id, work_item_id, github_id, comment_type, author_login,
        body, path, commit_id, github_created_at, github_updated_at, raw_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const comment of input.issue_comments) {
      insertComment.run(
        row.id,
        snapshot.app_id,
        snapshot.work_item_id,
        Number(comment.id),
        "issue",
        comment.user?.login ?? null,
        String(comment.body ?? ""),
        null,
        null,
        comment.created_at ?? null,
        comment.updated_at ?? null,
        JSON.stringify(comment),
        now,
      );
    }
    for (const comment of input.review_comments) {
      insertComment.run(
        row.id,
        snapshot.app_id,
        snapshot.work_item_id,
        Number(comment.id),
        "review",
        comment.user?.login ?? null,
        String(comment.body ?? ""),
        comment.path ?? null,
        comment.commit_id ?? null,
        comment.created_at ?? null,
        comment.updated_at ?? null,
        JSON.stringify(comment),
        now,
      );
    }

    const insertReview = db.prepare(
      `INSERT OR REPLACE INTO github_pr_reviews (
        pr_snapshot_id, app_id, work_item_id, github_id, author_login, state,
        body, submitted_at, raw_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const review of input.reviews) {
      insertReview.run(
        row.id,
        snapshot.app_id,
        snapshot.work_item_id,
        Number(review.id),
        review.user?.login ?? null,
        review.state ?? null,
        String(review.body ?? ""),
        review.submitted_at ?? null,
        JSON.stringify(review),
        now,
      );
    }

    const insertCommit = db.prepare(
      `INSERT OR REPLACE INTO github_pr_commits (
        pr_snapshot_id, app_id, work_item_id, sha, author_login, author_name,
        author_email, committer_login, message, authored_at, committed_at, raw_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const commit of input.commits) {
      insertCommit.run(
        row.id,
        snapshot.app_id,
        snapshot.work_item_id,
        String(commit.sha),
        commit.author?.login ?? null,
        commit.commit?.author?.name ?? null,
        commit.commit?.author?.email ?? null,
        commit.committer?.login ?? null,
        String(commit.commit?.message ?? ""),
        commit.commit?.author?.date ?? null,
        commit.commit?.committer?.date ?? null,
        JSON.stringify(commit),
        now,
      );
    }

    return db.prepare("SELECT * FROM github_pr_snapshots WHERE id = ?").get(row.id) as GitHubPrSnapshotRow;
  });

  return tx();
}
