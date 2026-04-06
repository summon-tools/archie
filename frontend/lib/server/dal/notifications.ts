import { getDb } from "../db";
import type { NotificationRow } from "../types";

export interface NotificationWithApp extends NotificationRow {
  app_name: string;
}

export function getNotification(id: number): NotificationRow | undefined {
  return getDb()
    .prepare("SELECT * FROM notifications WHERE id = ?")
    .get(id) as NotificationRow | undefined;
}

export function getNotifications(
  filters?: { appId?: number; recipientUserId?: number; status?: string; automationKey?: string; limit?: number }
): NotificationRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.appId) {
    conditions.push("app_id = ?");
    params.push(filters.appId);
  }
  if (filters?.recipientUserId) {
    conditions.push("recipient_user_id = ?");
    params.push(filters.recipientUserId);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters?.automationKey) {
    conditions.push("automation_key = ?");
    params.push(filters.automationKey);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit ? `LIMIT ${filters.limit}` : "";

  return getDb()
    .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC ${limit}`)
    .all(...params) as NotificationRow[];
}

export function getAllNotifications(
  filters?: { appId?: number; recipientUserId?: number; status?: string }
): NotificationWithApp[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.appId) {
    conditions.push("n.app_id = ?");
    params.push(filters.appId);
  }
  if (filters?.recipientUserId) {
    conditions.push("n.recipient_user_id = ?");
    params.push(filters.recipientUserId);
  }
  if (filters?.status) {
    conditions.push("n.status = ?");
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return getDb()
    .prepare(
      `SELECT n.*, a.name as app_name
       FROM notifications n
       JOIN apps a ON a.id = n.app_id
       ${where}
       ORDER BY n.created_at DESC`
    )
    .all(...params) as NotificationWithApp[];
}

export function createNotification(data: {
  app_id: number;
  kind: string;
  title: string;
  summary_md?: string;
  recipient_user_id?: number | null;
  subject_user_id?: number | null;
  related_conversation_id?: number | null;
  related_work_item_id?: number | null;
  automation_key?: string | null;
  automation_run_id?: number | null;
  metadata_json?: string | null;
}): NotificationRow {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO notifications
         (app_id, kind, title, summary_md, recipient_user_id, subject_user_id,
          related_conversation_id, related_work_item_id, automation_key, automation_run_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.app_id,
      data.kind,
      data.title,
      data.summary_md || "",
      data.recipient_user_id ?? null,
      data.subject_user_id ?? null,
      data.related_conversation_id ?? null,
      data.related_work_item_id ?? null,
      data.automation_key ?? null,
      data.automation_run_id ?? null,
      data.metadata_json ?? null
    );
  return db.prepare("SELECT * FROM notifications WHERE id = ?").get(result.lastInsertRowid) as NotificationRow;
}

export function markNotificationRead(id: number): void {
  getDb()
    .prepare("UPDATE notifications SET status = 'read', read_at = datetime('now') WHERE id = ?")
    .run(id);
}

export function markAllRead(recipientUserId?: number, appId?: number): void {
  const conditions = ["status = 'unread'"];
  const params: unknown[] = [];

  if (recipientUserId) {
    conditions.push("recipient_user_id = ?");
    params.push(recipientUserId);
  }
  if (appId) {
    conditions.push("app_id = ?");
    params.push(appId);
  }

  getDb()
    .prepare(`UPDATE notifications SET status = 'read', read_at = datetime('now') WHERE ${conditions.join(" AND ")}`)
    .run(...params);
}

export function getUnreadCount(recipientUserId?: number, appId?: number): number {
  const conditions = ["status = 'unread'"];
  const params: unknown[] = [];

  if (recipientUserId) {
    conditions.push("recipient_user_id = ?");
    params.push(recipientUserId);
  }
  if (appId) {
    conditions.push("app_id = ?");
    params.push(appId);
  }

  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM notifications WHERE ${conditions.join(" AND ")}`)
    .get(...params) as { count: number };
  return row.count;
}

export function getAllUnreadCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM notifications WHERE status = 'unread'")
    .get() as { count: number };
  return row.count;
}
