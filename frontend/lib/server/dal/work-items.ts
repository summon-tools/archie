import { getDb } from "../db";
import type { WorkItemRow, WorkItemEnvRow, WorkItemKind } from "../types";

export function getWorkItem(workItemId: number): WorkItemRow | undefined {
  return getDb().prepare("SELECT * FROM work_items WHERE id = ?").get(workItemId) as WorkItemRow | undefined;
}

export function getWorkItemsByApp(appId: number): (WorkItemRow & { created_by_name: string | null; created_by_color: string | null })[] {
  return getDb().prepare(
    `SELECT wi.*, u.name as created_by_name, u.color as created_by_color
     FROM work_items wi LEFT JOIN users u ON wi.created_by = u.id
     WHERE wi.app_id = ? ORDER BY wi.position ASC`
  ).all(appId) as any[];
}

export function getWorkItemByConversationId(conversationId: number): WorkItemRow | undefined {
  return getDb().prepare(
    "SELECT * FROM work_items WHERE primary_conversation_id = ?"
  ).get(conversationId) as WorkItemRow | undefined;
}

export function createWorkItem(data: {
  app_id: number;
  primary_conversation_id: number;
  title: string;
  summary?: string;
  kind?: WorkItemKind;
  created_by?: number | null;
  origin_type?: string;
  origin_automation_key?: string | null;
  origin_run_id?: number | null;
}): WorkItemRow {
  const db = getDb();
  // Auto-position
  const maxPos = db.prepare(
    "SELECT COALESCE(MAX(position), -1) as max_pos FROM work_items WHERE app_id = ?"
  ).get(data.app_id) as { max_pos: number };

  const result = db.prepare(
    `INSERT INTO work_items (app_id, primary_conversation_id, title, summary, kind, position, created_by, origin_type, origin_automation_key, origin_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.app_id,
    data.primary_conversation_id,
    data.title,
    data.summary || "",
    data.kind || "task",
    maxPos.max_pos + 1,
    data.created_by ?? null,
    data.origin_type || "user",
    data.origin_automation_key ?? null,
    data.origin_run_id ?? null
  );
  return db.prepare("SELECT * FROM work_items WHERE id = ?").get(result.lastInsertRowid) as WorkItemRow;
}

export function updateWorkItem(workItemId: number, fields: Partial<Pick<WorkItemRow, "title" | "summary" | "status" | "position" | "assigned_to" | "completed_at" | "completed_by_user_id">>): void {
  const db = getDb();
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(fields)) {
    setParts.push(`${key} = ?`);
    values.push(val);
  }
  if (setParts.length === 0) return;
  setParts.push("updated_at = datetime('now')");
  values.push(workItemId);
  db.prepare(`UPDATE work_items SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteWorkItem(workItemId: number): void {
  const db = getDb();
  const del = db.transaction(() => {
    // Clean up child rows that lack ON DELETE CASCADE
    db.prepare("DELETE FROM artifacts WHERE work_item_id = ?").run(workItemId);
    db.prepare("DELETE FROM runs WHERE work_item_id = ?").run(workItemId);
    // work_item_env has ON DELETE CASCADE but be explicit for clarity
    db.prepare("DELETE FROM work_item_env WHERE work_item_id = ?").run(workItemId);
    // Delete the work item itself (conversation/messages cascade from conversation FK)
    db.prepare("DELETE FROM work_items WHERE id = ?").run(workItemId);
  });
  del();
}

export function getWorkItemEnv(workItemId: number): WorkItemEnvRow | undefined {
  return getDb().prepare("SELECT * FROM work_item_env WHERE work_item_id = ?").get(workItemId) as WorkItemEnvRow | undefined;
}

export function ensureWorkItemEnv(workItemId: number): void {
  const db = getDb();
  const existing = db.prepare("SELECT work_item_id FROM work_item_env WHERE work_item_id = ?").get(workItemId);
  if (!existing) {
    db.prepare("INSERT INTO work_item_env (work_item_id) VALUES (?)").run(workItemId);
  }
}

export function updateWorkItemEnv(workItemId: number, fields: Partial<Omit<WorkItemEnvRow, "work_item_id">>): void {
  const db = getDb();
  ensureWorkItemEnv(workItemId);
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(fields)) {
    setParts.push(`${key} = ?`);
    values.push(val);
  }
  if (setParts.length === 0) return;
  values.push(workItemId);
  db.prepare(`UPDATE work_item_env SET ${setParts.join(", ")} WHERE work_item_id = ?`).run(...values);
}

export function getWorkItemCounts(appId: number): { in_progress: number; done: number } {
  const rows = getDb().prepare(
    "SELECT status, COUNT(*) as count FROM work_items WHERE app_id = ? GROUP BY status"
  ).all(appId) as { status: string; count: number }[];
  const counts = { in_progress: 0, done: 0 };
  for (const row of rows) {
    if (row.status === "in_progress") counts.in_progress = row.count;
    else if (row.status === "done") counts.done = row.count;
  }
  return counts;
}
