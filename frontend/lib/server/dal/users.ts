import { getDb } from "../db";
import type { UserRow, InvitationRow } from "../types";

export function getUser(userId: number): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
}

export function getUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
}

export function getUsers(): UserRow[] {
  return getDb().prepare(
    "SELECT * FROM users WHERE username != '__archie_automation__' ORDER BY created_at ASC"
  ).all() as UserRow[];
}

export function getActiveUsers(): UserRow[] {
  return getDb().prepare(
    "SELECT * FROM users WHERE deleted_at IS NULL AND username != '__archie_automation__' ORDER BY created_at ASC"
  ).all() as UserRow[];
}

export function createUser(data: {
  username: string;
  password_hash: string;
  name: string;
  role?: string;
  email?: string | null;
  color?: string | null;
}): UserRow {
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO users (username, password_hash, name, role, email, color) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(data.username, data.password_hash, data.name, data.role || "member", data.email ?? null, data.color ?? null);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as UserRow;
}

export function updateUser(userId: number, fields: Partial<Pick<UserRow, "name" | "role" | "email" | "color" | "password_hash" | "deleted_at">>): void {
  const db = getDb();
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(fields)) {
    setParts.push(`${key} = ?`);
    values.push(val);
  }
  if (setParts.length === 0) return;
  values.push(userId);
  db.prepare(`UPDATE users SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
}

// ── Settings helpers ──────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb().prepare(
    "SELECT value_json FROM system_settings WHERE key = ?"
  ).get(key) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return row.value_json;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb().prepare(
    "INSERT OR REPLACE INTO system_settings (key, value_json) VALUES (?, ?)"
  ).run(key, JSON.stringify(value));
}

export function deleteSetting(key: string): boolean {
  const result = getDb().prepare("DELETE FROM system_settings WHERE key = ?").run(key);
  return result.changes > 0;
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value_json FROM system_settings").all() as { key: string; value_json: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value_json);
    } catch {
      result[row.key] = row.value_json;
    }
  }
  return result;
}
