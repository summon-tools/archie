import { getDb } from "../db";
import type { McpAuditEventRow, McpTokenRow } from "../types";

export interface McpTokenRecord {
  id: number;
  name: string;
  token_prefix: string;
  created_by_user_id: number | null;
  created_by_user_name: string | null;
  created_by_user_email: string | null;
  scopes: string[];
  allowed_app_ids: number[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMcpTokenInput {
  name: string;
  token_hash: string;
  token_prefix: string;
  created_by_user_id?: number | null;
  scopes: string[];
  allowed_app_ids?: number[];
  expires_at?: string | null;
}

type McpTokenJoinedRow = McpTokenRow & {
  created_by_user_name?: string | null;
  created_by_user_email?: string | null;
};

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function parseNumberArray(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is number => Number.isInteger(entry) && entry > 0);
  } catch {
    return [];
  }
}

function serializeToken(row: McpTokenJoinedRow): McpTokenRecord {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    created_by_user_id: row.created_by_user_id,
    created_by_user_name: row.created_by_user_name ?? null,
    created_by_user_email: row.created_by_user_email ?? null,
    scopes: parseStringArray(row.scopes_json),
    allowed_app_ids: parseNumberArray(row.allowed_app_ids_json),
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function selectMcpTokenById(id: number): McpTokenJoinedRow | undefined {
  return getDb()
    .prepare(`
      SELECT
        t.*,
        u.name as created_by_user_name,
        u.email as created_by_user_email
      FROM mcp_tokens t
      LEFT JOIN users u ON u.id = t.created_by_user_id
      WHERE t.id = ?
    `)
    .get(id) as McpTokenJoinedRow | undefined;
}

export function createMcpToken(input: CreateMcpTokenInput): McpTokenRecord {
  const result = getDb().prepare(
    `INSERT INTO mcp_tokens
      (name, token_hash, token_prefix, created_by_user_id, scopes_json, allowed_app_ids_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.name,
    input.token_hash,
    input.token_prefix,
    input.created_by_user_id ?? null,
    JSON.stringify(input.scopes),
    JSON.stringify(input.allowed_app_ids ?? []),
    input.expires_at ?? null,
  );

  const row = selectMcpTokenById(Number(result.lastInsertRowid));
  if (!row) throw new Error("Created MCP token could not be read back");
  return serializeToken(row);
}

export function listMcpTokens(): McpTokenRecord[] {
  const rows = getDb()
    .prepare(`
      SELECT
        t.*,
        u.name as created_by_user_name,
        u.email as created_by_user_email
      FROM mcp_tokens t
      LEFT JOIN users u ON u.id = t.created_by_user_id
      ORDER BY t.created_at DESC
    `)
    .all() as McpTokenJoinedRow[];
  return rows.map(serializeToken);
}

export function getMcpTokenById(id: number): McpTokenRecord | undefined {
  const row = selectMcpTokenById(id);
  return row ? serializeToken(row) : undefined;
}

export function getMcpTokenByHash(tokenHash: string): (McpTokenRecord & { token_hash: string }) | undefined {
  const row = getDb()
    .prepare("SELECT * FROM mcp_tokens WHERE token_hash = ?")
    .get(tokenHash) as McpTokenRow | undefined;
  return row ? { ...serializeToken(row), token_hash: row.token_hash } : undefined;
}

export function touchMcpToken(id: number): void {
  getDb().prepare(
    "UPDATE mcp_tokens SET last_used_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(id);
}

export function revokeMcpToken(id: number): boolean {
  const result = getDb().prepare(
    "UPDATE mcp_tokens SET revoked_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND revoked_at IS NULL"
  ).run(id);
  return result.changes > 0;
}

export function deleteMcpToken(id: number): boolean {
  const db = getDb();
  const deleteToken = db.transaction((tokenId: number) => {
    db.prepare("UPDATE mcp_audit_events SET token_id = NULL WHERE token_id = ?").run(tokenId);
    return db.prepare("DELETE FROM mcp_tokens WHERE id = ?").run(tokenId).changes;
  });
  return deleteToken(id) > 0;
}

export function createMcpAuditEvent(input: {
  token_id?: number | null;
  app_id?: number | null;
  tool_name: string;
  input_summary_json?: string | null;
  result_summary_json?: string | null;
  status: "success" | "error";
  error_text?: string | null;
  duration_ms?: number | null;
}): McpAuditEventRow {
  const result = getDb().prepare(
    `INSERT INTO mcp_audit_events
      (token_id, app_id, tool_name, input_summary_json, result_summary_json, status, error_text, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.token_id ?? null,
    input.app_id ?? null,
    input.tool_name,
    input.input_summary_json ?? null,
    input.result_summary_json ?? null,
    input.status,
    input.error_text ?? null,
    input.duration_ms ?? null,
  );

  return getDb()
    .prepare("SELECT * FROM mcp_audit_events WHERE id = ?")
    .get(result.lastInsertRowid) as McpAuditEventRow;
}
