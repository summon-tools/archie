import { getDb } from "../db";
import type { AgentSessionRow } from "../types";

export function getSession(sessionId: number): AgentSessionRow | undefined {
  return getDb().prepare("SELECT * FROM agent_sessions WHERE id = ?").get(sessionId) as AgentSessionRow | undefined;
}

export function getSessionForConversation(conversationId: number): AgentSessionRow | undefined {
  return getDb().prepare(
    "SELECT * FROM agent_sessions WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 1"
  ).get(conversationId) as AgentSessionRow | undefined;
}

export function createSession(data: {
  conversation_id: number;
  provider_id?: string;
  external_session_id?: string | null;
  status?: string;
  last_model_id?: string | null;
}): AgentSessionRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO agent_sessions (conversation_id, provider_id, external_session_id, status, last_model_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    data.conversation_id,
    data.provider_id || "claude",
    data.external_session_id ?? null,
    data.status || null,
    data.last_model_id ?? null
  );
  return db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(result.lastInsertRowid) as AgentSessionRow;
}

export function updateSession(sessionId: number, fields: Partial<Pick<AgentSessionRow, "provider_id" | "external_session_id" | "status" | "last_model_id" | "metadata_json">>): void {
  const db = getDb();
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(fields)) {
    setParts.push(`${key} = ?`);
    values.push(val);
  }
  if (setParts.length === 0) return;
  setParts.push("updated_at = datetime('now')");
  values.push(sessionId);
  db.prepare(`UPDATE agent_sessions SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
}

export function upsertSessionForConversation(conversationId: number, fields: {
  provider_id?: string;
  external_session_id?: string | null;
  status?: string;
  last_model_id?: string | null;
}): AgentSessionRow {
  const existing = getSessionForConversation(conversationId);
  if (existing) {
    updateSession(existing.id, fields);
    return { ...existing, ...fields, updated_at: new Date().toISOString() };
  }
  return createSession({ conversation_id: conversationId, ...fields });
}
