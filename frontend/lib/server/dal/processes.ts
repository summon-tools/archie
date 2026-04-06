import { getDb } from "../db";

export interface ManagedProcessRow {
  id: number;
  app_id: number;
  work_item_id: number | null;
  kind: string;
  pid: number | null;
  port: number | null;
  log_path: string | null;
  status: string;
  started_at: string;
  stopped_at: string | null;
}

export function registerProcess(data: {
  app_id: number;
  kind: string;
  pid?: number | null;
  port?: number | null;
  log_path?: string | null;
  work_item_id?: number | null;
}): ManagedProcessRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO managed_processes (app_id, work_item_id, kind, pid, port, log_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    data.app_id,
    data.work_item_id ?? null,
    data.kind,
    data.pid ?? null,
    data.port ?? null,
    data.log_path ?? null
  );
  return db.prepare("SELECT * FROM managed_processes WHERE id = ?").get(result.lastInsertRowid) as ManagedProcessRow;
}

export function getActiveProcess(
  appId: number,
  kind: string,
  workItemId?: number | null
): ManagedProcessRow | undefined {
  const db = getDb();
  if (workItemId !== undefined && workItemId !== null) {
    return db.prepare(
      "SELECT * FROM managed_processes WHERE app_id = ? AND kind = ? AND work_item_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1"
    ).get(appId, kind, workItemId) as ManagedProcessRow | undefined;
  }
  return db.prepare(
    "SELECT * FROM managed_processes WHERE app_id = ? AND kind = ? AND work_item_id IS NULL AND status = 'running' ORDER BY started_at DESC LIMIT 1"
  ).get(appId, kind) as ManagedProcessRow | undefined;
}

export function updateProcessStatus(id: number, status: string): void {
  const db = getDb();
  const updates = status === "running"
    ? "status = ?"
    : "status = ?, stopped_at = datetime('now')";
  db.prepare(`UPDATE managed_processes SET ${updates} WHERE id = ?`).run(
    ...(status === "running" ? [status, id] : [status, id])
  );
}

export function listProcesses(appId: number): ManagedProcessRow[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM managed_processes WHERE app_id = ? ORDER BY started_at DESC"
  ).all(appId) as ManagedProcessRow[];
}

export function getProcess(id: number): ManagedProcessRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM managed_processes WHERE id = ?").get(id) as ManagedProcessRow | undefined;
}
