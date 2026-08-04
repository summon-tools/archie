import { getDb } from "../db";
import type { TaskRow, TaskStatus, TaskWorkItemRow } from "../types";
import { getArtifactByKind } from "./artifacts";
import { getWorkItemEnv } from "./work-items";

export function getTask(taskId: number): TaskRow | undefined {
  return getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
}

export function getTasksByApp(appId: number): (TaskRow & {
  created_by_name: string | null;
  created_by_color: string | null;
  assigned_to_name: string | null;
})[] {
  return getDb().prepare(
    `SELECT t.*,
            creator.name AS created_by_name,
            creator.color AS created_by_color,
            assignee.name AS assigned_to_name
     FROM tasks t
     LEFT JOIN users creator ON t.created_by = creator.id
     LEFT JOIN users assignee ON t.assigned_to = assignee.id
     WHERE t.app_id = ?
     ORDER BY CASE t.status
      WHEN 'todo' THEN 0
      WHEN 'in_progress' THEN 1
      WHEN 'done' THEN 2
      ELSE 3
     END, t.position ASC, t.created_at ASC`
  ).all(appId) as any[];
}

export function getTaskWorkItems(taskId: number): TaskWorkItemRow[] {
  const rows = getDb().prepare(
    `SELECT twi.task_id,
            twi.work_item_id,
            twi.relation_type,
            wi.title AS work_item_title,
            wi.status AS work_item_status,
            wi.primary_conversation_id,
            env.branch_name,
            twi.created_at
     FROM task_work_items twi
     JOIN work_items wi ON wi.id = twi.work_item_id
     LEFT JOIN work_item_env env ON env.work_item_id = wi.id
     WHERE twi.task_id = ?
     ORDER BY twi.created_at DESC`
  ).all(taskId) as TaskWorkItemRow[];

  return rows.map((row) => {
    const artifact = getArtifactByKind(row.work_item_id, "pull_request");
    let prUrl: string | null = null;
    let prNumber: number | null = null;
    if (artifact?.metadata_json) {
      try {
        const metadata = JSON.parse(artifact.metadata_json) as { pr_url?: string; pr_number?: number };
        prUrl = metadata.pr_url || null;
        prNumber = metadata.pr_number || null;
      } catch {}
    }
    return { ...row, branch_name: getWorkItemEnv(row.work_item_id)?.branch_name || row.branch_name || null, pr_url: prUrl, pr_number: prNumber };
  });
}

export function createTask(data: {
  app_id: number;
  title: string;
  description?: string;
  status?: TaskStatus;
  created_by?: number | null;
  assigned_to?: number | null;
  origin_type?: string;
}): TaskRow {
  const db = getDb();
  const status = data.status || "todo";
  const maxPosition = db.prepare(
    "SELECT COALESCE(MAX(position), -1) AS max_pos FROM tasks WHERE app_id = ? AND status = ?"
  ).get(data.app_id, status) as { max_pos: number };
  const result = db.prepare(
    `INSERT INTO tasks (
      app_id, title, description, status, position,
      created_by, assigned_to, origin_type, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.app_id,
    data.title,
    data.description || "",
    status,
    maxPosition.max_pos + 1,
    data.created_by ?? null,
    data.assigned_to ?? null,
    data.origin_type || "user",
    status === "done" ? new Date().toISOString() : null,
  );
  return getTask(Number(result.lastInsertRowid))!;
}

export function updateTask(taskId: number, fields: Partial<Pick<TaskRow, "title" | "description" | "status" | "position" | "assigned_to">>): TaskRow {
  const db = getDb();
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    setParts.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.status !== undefined) {
    setParts.push("completed_at = ?");
    values.push(fields.status === "done" ? new Date().toISOString() : null);
  }
  if (setParts.length === 0) return getTask(taskId)!;
  setParts.push("updated_at = datetime('now')");
  values.push(taskId);
  db.prepare(`UPDATE tasks SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
  return getTask(taskId)!;
}

export function linkTaskToWorkItem(taskId: number, workItemId: number, relationType = "implementation"): void {
  const db = getDb();
  const task = getTask(taskId);
  const workItem = db.prepare("SELECT id, app_id FROM work_items WHERE id = ?").get(workItemId) as { id: number; app_id: number } | undefined;
  if (!task || !workItem || task.app_id !== workItem.app_id) throw new Error("Task and work item must belong to the same project");
  db.prepare(
    "INSERT OR IGNORE INTO task_work_items (task_id, work_item_id, relation_type) VALUES (?, ?, ?)"
  ).run(taskId, workItemId, relationType);
}

export function deleteTask(taskId: number): void {
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
}

export function getTaskIdsForWorkItem(workItemId: number): number[] {
  return (getDb().prepare(
    "SELECT task_id FROM task_work_items WHERE work_item_id = ? ORDER BY task_id"
  ).all(workItemId) as { task_id: number }[]).map((row) => row.task_id);
}
