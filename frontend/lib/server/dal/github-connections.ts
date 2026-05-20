import { getDb } from "../db";
import type { GitHubUserConnectionRow } from "../types";

export function getGitHubUserConnection(userId: number): GitHubUserConnectionRow | undefined {
  return getDb()
    .prepare("SELECT * FROM github_user_connections WHERE user_id = ? AND revoked_at IS NULL")
    .get(userId) as GitHubUserConnectionRow | undefined;
}

export function upsertGitHubUserConnection(data: {
  user_id: number;
  github_user_id: number;
  github_login: string;
  github_name?: string | null;
  github_email?: string | null;
  access_token_ciphertext: string;
  refresh_token_ciphertext?: string | null;
  access_token_expires_at?: string | null;
  refresh_token_expires_at?: string | null;
}): GitHubUserConnectionRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO github_user_connections (
      user_id, github_user_id, github_login, github_name, github_email,
      access_token_ciphertext, refresh_token_ciphertext,
      access_token_expires_at, refresh_token_expires_at,
      connected_at, updated_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      github_user_id = excluded.github_user_id,
      github_login = excluded.github_login,
      github_name = excluded.github_name,
      github_email = excluded.github_email,
      access_token_ciphertext = excluded.access_token_ciphertext,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      access_token_expires_at = excluded.access_token_expires_at,
      refresh_token_expires_at = excluded.refresh_token_expires_at,
      updated_at = datetime('now'),
      revoked_at = NULL`
  ).run(
    data.user_id,
    data.github_user_id,
    data.github_login,
    data.github_name ?? null,
    data.github_email ?? null,
    data.access_token_ciphertext,
    data.refresh_token_ciphertext ?? null,
    data.access_token_expires_at ?? null,
    data.refresh_token_expires_at ?? null,
  );
  return getGitHubUserConnection(data.user_id)!;
}

export function updateGitHubUserConnectionTokens(
  userId: number,
  fields: Pick<
    GitHubUserConnectionRow,
    "access_token_ciphertext" | "refresh_token_ciphertext" | "access_token_expires_at" | "refresh_token_expires_at"
  >,
): void {
  getDb().prepare(
    `UPDATE github_user_connections
     SET access_token_ciphertext = ?,
         refresh_token_ciphertext = ?,
         access_token_expires_at = ?,
         refresh_token_expires_at = ?,
         updated_at = datetime('now')
     WHERE user_id = ?`
  ).run(
    fields.access_token_ciphertext,
    fields.refresh_token_ciphertext,
    fields.access_token_expires_at,
    fields.refresh_token_expires_at,
    userId,
  );
}

export function revokeGitHubUserConnection(userId: number): boolean {
  const result = getDb().prepare(
    "UPDATE github_user_connections SET revoked_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL"
  ).run(userId);
  return result.changes > 0;
}
