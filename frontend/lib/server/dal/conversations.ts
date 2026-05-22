import { getDb } from "../db";
import type { ConversationRow, MessageRow, ConversationKind } from "../types";

export function getConversation(conversationId: number): ConversationRow | undefined {
  return getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as ConversationRow | undefined;
}

export function getConversationStats(appId: number): {
  total: number;
  open: number;
  previewPorts: number[];
} {
  const db = getDb();
  const totalRow = db
    .prepare("SELECT COUNT(*) as n FROM conversations WHERE app_id = ?")
    .get(appId) as { n: number };
  const openRow = db
    .prepare(
      "SELECT COUNT(*) as n FROM conversations WHERE app_id = ? AND status = 'open'"
    )
    .get(appId) as { n: number };
  const portRows = db
    .prepare(
      `SELECT env.preview_port
       FROM work_item_env env
       JOIN work_items wi ON wi.id = env.work_item_id
       WHERE wi.app_id = ? AND env.preview_port IS NOT NULL`
    )
    .all(appId) as { preview_port: number }[];
  return {
    total: totalRow.n,
    open: openRow.n,
    previewPorts: portRows.map((r) => r.preview_port),
  };
}

export function getConversationsByApp(appId: number, kind?: ConversationKind): ConversationRow[] {
  if (kind) {
    return getDb().prepare(
      "SELECT * FROM conversations WHERE app_id = ? AND kind = ? ORDER BY last_message_at DESC, created_at DESC"
    ).all(appId, kind) as ConversationRow[];
  }
  return getDb().prepare(
    "SELECT * FROM conversations WHERE app_id = ? ORDER BY last_message_at DESC, created_at DESC"
  ).all(appId) as ConversationRow[];
}

export function createConversation(data: {
  app_id: number;
  kind: ConversationKind;
  title: string;
  created_by?: number | null;
  origin_type?: string;
  origin_automation_key?: string | null;
  origin_run_id?: number | null;
}): ConversationRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO conversations (app_id, kind, title, created_by, origin_type, origin_automation_key, origin_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.app_id, data.kind, data.title, data.created_by ?? null,
    data.origin_type || "user", data.origin_automation_key ?? null, data.origin_run_id ?? null
  );
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(result.lastInsertRowid) as ConversationRow;
}

export function updateConversation(conversationId: number, fields: Partial<Pick<ConversationRow, "title" | "status" | "last_message_at">>): void {
  const db = getDb();
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(fields)) {
    setParts.push(`${key} = ?`);
    values.push(val);
  }
  if (setParts.length === 0) return;
  setParts.push("updated_at = datetime('now')");
  values.push(conversationId);
  db.prepare(`UPDATE conversations SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteConversation(conversationId: number): void {
  getDb().prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
}

export function getConversationMessages(conversationId: number, limit = 200): (MessageRow & { author_name: string | null; author_color: string | null })[] {
  return getDb().prepare(
    `SELECT m.*, u.name as author_name, u.color as author_color
     FROM messages m LEFT JOIN users u ON m.author_user_id = u.id
     WHERE m.conversation_id = ? ORDER BY m.seq ASC, m.id ASC LIMIT ?`
  ).all(conversationId, limit) as any[];
}

export function createMessage(data: {
  conversation_id: number;
  role: "user" | "assistant" | "system";
  kind?: string;
  author_user_id?: number | null;
  body_md: string;
  payload_json?: string | null;
  model_id?: string | null;
  provider_id?: string | null;
}): MessageRow {
  const db = getDb();
  // Get next seq
  const maxSeq = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) as max_seq FROM messages WHERE conversation_id = ?"
  ).get(data.conversation_id) as { max_seq: number };
  const seq = maxSeq.max_seq + 1;

  const result = db.prepare(
    `INSERT INTO messages (conversation_id, seq, role, kind, author_user_id, body_md, payload_json, model_id, provider_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.conversation_id,
    seq,
    data.role,
    data.kind || "text",
    data.author_user_id ?? null,
    data.body_md,
    data.payload_json ?? null,
    data.model_id ?? null,
    data.provider_id ?? null
  );

  // Update conversation last_message_at
  db.prepare("UPDATE conversations SET last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(data.conversation_id);

  return db.prepare("SELECT * FROM messages WHERE id = ?").get(result.lastInsertRowid) as MessageRow;
}

export function getMessageCount(conversationId: number): number {
  const row = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?"
  ).get(conversationId) as { cnt: number };
  return row.cnt;
}

// --- System messages ---

export function addSystemMessage(conversationId: number, text: string): MessageRow {
  return createMessage({
    conversation_id: conversationId,
    role: "system",
    kind: "text",
    body_md: text,
  });
}

// --- Conversation listing for sidebar ---

export interface ConversationListItem {
  id: number;
  title: string;
  status: string;
  last_message_at: string | null;
  created_at: string;
  // Joined from work_items
  work_item_id: number | null;
  work_item_status: string | null;
  work_item_kind: string | null;
  branch_name: string | null;
  pr_url: string | null;
  pr_number: number | null;
}

export function getConversationsForApp(appId: number): ConversationListItem[] {
  return getDb().prepare(`
    SELECT
      c.id, c.title, c.status, c.last_message_at, c.created_at,
      wi.id as work_item_id, wi.status as work_item_status, wi.kind as work_item_kind,
      env.branch_name,
      a.metadata_json as pr_meta_json
    FROM conversations c
    LEFT JOIN work_items wi ON wi.primary_conversation_id = c.id
    LEFT JOIN work_item_env env ON env.work_item_id = wi.id
    LEFT JOIN artifacts a ON a.work_item_id = wi.id AND a.kind = 'pull_request'
    WHERE c.app_id = ?
    ORDER BY
      CASE WHEN c.status = 'archived' THEN 1 ELSE 0 END,
      c.last_message_at DESC NULLS LAST
  `).all(appId).map((row: any) => {
    let pr_url = null;
    let pr_number = null;
    if (row.pr_meta_json) {
      try {
        const meta = JSON.parse(row.pr_meta_json);
        pr_url = meta.pr_url || null;
        pr_number = meta.pr_number || null;
      } catch {}
    }
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      last_message_at: row.last_message_at,
      created_at: row.created_at,
      work_item_id: row.work_item_id,
      work_item_status: row.work_item_status,
      work_item_kind: row.work_item_kind,
      branch_name: row.branch_name,
      pr_url,
      pr_number,
    };
  });
}
