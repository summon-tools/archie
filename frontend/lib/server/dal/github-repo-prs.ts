import { getDb } from "../db";
import type { GitHubRepoPullRequestFileRow, GitHubRepoPullRequestRow } from "../types";

export interface UpsertGitHubRepoPullRequestInput {
  owner: string;
  repo: string;
  pr_number: number;
  pr_url: string;
  title?: string | null;
  body?: string | null;
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
  raw_json?: string | null;
}

export interface ReplaceGitHubRepoPullRequestFilesInput {
  repo_pr_id: number;
  owner: string;
  repo: string;
  pr_number: number;
  files: Array<Record<string, any>>;
}

export function upsertGitHubRepoPullRequest(input: UpsertGitHubRepoPullRequestInput): GitHubRepoPullRequestRow {
  const syncedAt = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO github_repo_pull_requests (
      owner, repo, pr_number, pr_url, title, body, state, author_login, head_ref, base_ref,
      merged_at, closed_at, github_created_at, github_updated_at, additions, deletions,
      changed_files, raw_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner, repo, pr_number) DO UPDATE SET
      pr_url = excluded.pr_url,
      title = excluded.title,
      body = excluded.body,
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
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at`
  ).run(
    input.owner,
    input.repo,
    input.pr_number,
    input.pr_url,
    input.title ?? "",
    input.body ?? "",
    input.state,
    input.author_login ?? null,
    input.head_ref ?? null,
    input.base_ref ?? null,
    input.merged_at ?? null,
    input.closed_at ?? null,
    input.github_created_at ?? null,
    input.github_updated_at ?? null,
    input.additions ?? null,
    input.deletions ?? null,
    input.changed_files ?? null,
    input.raw_json ?? null,
    syncedAt,
  );
  return getGitHubRepoPullRequest(input.owner, input.repo, input.pr_number)!;
}

export function getGitHubRepoPullRequest(owner: string, repo: string, prNumber: number): GitHubRepoPullRequestRow | undefined {
  return getDb()
    .prepare("SELECT * FROM github_repo_pull_requests WHERE owner = ? AND repo = ? AND pr_number = ?")
    .get(owner, repo, prNumber) as GitHubRepoPullRequestRow | undefined;
}

export function replaceGitHubRepoPullRequestFiles(input: ReplaceGitHubRepoPullRequestFilesInput): GitHubRepoPullRequestFileRow[] {
  const db = getDb();
  const syncedAt = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM github_repo_pull_request_files WHERE repo_pr_id = ?").run(input.repo_pr_id);
    const insert = db.prepare(
      `INSERT INTO github_repo_pull_request_files (
        repo_pr_id, owner, repo, pr_number, filename, status, additions, deletions, changes, raw_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const file of input.files) {
      insert.run(
        input.repo_pr_id,
        input.owner,
        input.repo,
        input.pr_number,
        String(file.filename || ""),
        file.status ?? null,
        typeof file.additions === "number" ? file.additions : null,
        typeof file.deletions === "number" ? file.deletions : null,
        typeof file.changes === "number" ? file.changes : null,
        JSON.stringify(file),
        syncedAt,
      );
    }
    return listGitHubRepoPullRequestFiles(input.repo_pr_id);
  });
  return tx();
}

export function listGitHubRepoPullRequestFiles(repoPrId: number): GitHubRepoPullRequestFileRow[] {
  return getDb()
    .prepare("SELECT * FROM github_repo_pull_request_files WHERE repo_pr_id = ? ORDER BY filename ASC")
    .all(repoPrId) as GitHubRepoPullRequestFileRow[];
}
