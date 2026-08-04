import { getDb } from "../db";
import type { TaskDependencyRow, TaskPriority, TaskRow, TaskStatus, TaskWorkItemRow } from "../types";
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
       WHEN 'backlog' THEN 0
       WHEN 'ready' THEN 1
       WHEN 'in_progress' THEN 2
       WHEN 'review' THEN 3
       WHEN 'blocked' THEN 4
       WHEN 'done' THEN 5
       ELSE 6
     END, t.position ASC, t.created_at ASC`
  ).all(appId) as any[];
}

export function getTaskDependencies(taskId: number): TaskDependencyRow[] {
  return getDb().prepare(
    `SELECT td.task_id,
            td.depends_on_task_id,
            dependency.title AS depends_on_title,
            dependency.status AS depends_on_status,
            td.created_at
     FROM task_dependencies td
     JOIN tasks dependency ON dependency.id = td.depends_on_task_id
     WHERE td.task_id = ?
     ORDER BY dependency.position ASC, dependency.created_at ASC`
  ).all(taskId) as TaskDependencyRow[];
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
  priority?: TaskPriority;
  parent_task_id?: number | null;
  created_by?: number | null;
  assigned_to?: number | null;
  origin_type?: string;
  blocked_reason?: string | null;
}): TaskRow {
  const db = getDb();
  const status = data.status || "backlog";
  const maxPosition = db.prepare(
    "SELECT COALESCE(MAX(position), -1) AS max_pos FROM tasks WHERE app_id = ? AND status = ?"
  ).get(data.app_id, status) as { max_pos: number };
  const result = db.prepare(
    `INSERT INTO tasks (
      app_id, parent_task_id, title, description, status, priority, position,
      created_by, assigned_to, origin_type, blocked_reason, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.app_id,
    data.parent_task_id ?? null,
    data.title,
    data.description || "",
    status,
    data.priority || "medium",
    maxPosition.max_pos + 1,
    data.created_by ?? null,
    data.assigned_to ?? null,
    data.origin_type || "user",
    data.blocked_reason ?? null,
    status === "done" ? new Date().toISOString() : null,
  );
  return getTask(Number(result.lastInsertRowid))!;
}

export function updateTask(taskId: number, fields: Partial<Pick<TaskRow, "parent_task_id" | "title" | "description" | "status" | "priority" | "position" | "assigned_to" | "blocked_reason">>): TaskRow {
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

export function wouldCreateParentCycle(taskId: number, parentTaskId: number | null): boolean {
  if (parentTaskId === null) return false;
  const seen = new Set<number>();
  let current: number | null = parentTaskId;
  while (current !== null) {
    if (current === taskId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = getTask(current)?.parent_task_id ?? null;
  }
  return false;
}

export function getTaskDependencyIds(taskId: number): number[] {
  return (getDb().prepare(
    "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_task_id"
  ).all(taskId) as { depends_on_task_id: number }[]).map((row) => row.depends_on_task_id);
}

function wouldCreateDependencyCycle(taskId: number, dependencyIds: number[]): boolean {
  const db = getDb();
  const adjacency = new Map<number, number[]>();
  const rows = db.prepare(
    "SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id != ?"
  ).all(taskId) as { task_id: number; depends_on_task_id: number }[];
  for (const row of rows) {
    adjacency.set(row.task_id, [...(adjacency.get(row.task_id) || []), row.depends_on_task_id]);
  }
  adjacency.set(taskId, dependencyIds);

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (current: number): boolean => {
    if (visiting.has(current)) return true;
    if (visited.has(current)) return false;
    visiting.add(current);
    for (const dependency of adjacency.get(current) || []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(current);
    visited.add(current);
    return false;
  };
  return visit(taskId);
}

export function setTaskDependencies(taskId: number, dependencyIds: number[]): TaskDependencyRow[] {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) throw new Error("Task not found");
  const uniqueIds = Array.from(new Set(dependencyIds));
  if (uniqueIds.includes(taskId)) throw new Error("A task cannot depend on itself");
  const placeholders = uniqueIds.map(() => "?").join(", ");
  if (uniqueIds.length > 0) {
    const rows = db.prepare(`SELECT id, app_id FROM tasks WHERE id IN (${placeholders})`).all(...uniqueIds) as { id: number; app_id: number }[];
    if (rows.length !== uniqueIds.length || rows.some((row) => row.app_id !== task.app_id)) {
      throw new Error("Task dependencies must belong to the same project");
    }
  }
  if (wouldCreateDependencyCycle(taskId, uniqueIds)) throw new Error("Task dependencies cannot contain a cycle");

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(taskId);
    const insert = db.prepare("INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)");
    for (const dependencyId of uniqueIds) insert.run(taskId, dependencyId);
  });
  transaction();
  return getTaskDependencies(taskId);
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
