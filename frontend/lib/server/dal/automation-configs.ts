import { getDb } from "../db";
import type { AutomationConfigRow } from "../types";

export function getAutomationConfig(appId: number, automationKey: string): AutomationConfigRow | undefined {
  return getDb()
    .prepare("SELECT * FROM automation_configs WHERE app_id = ? AND automation_key = ?")
    .get(appId, automationKey) as AutomationConfigRow | undefined;
}

export function getAutomationConfigsForApp(appId: number): AutomationConfigRow[] {
  return getDb()
    .prepare("SELECT * FROM automation_configs WHERE app_id = ? ORDER BY automation_key")
    .all(appId) as AutomationConfigRow[];
}

export function getEnabledConfigs(automationKey: string): AutomationConfigRow[] {
  return getDb()
    .prepare("SELECT * FROM automation_configs WHERE automation_key = ? AND enabled = 1")
    .all(automationKey) as AutomationConfigRow[];
}

export function upsertAutomationConfig(
  appId: number,
  automationKey: string,
  fields: { enabled?: number; cronExpression?: string | null; configJson?: string }
): void {
  const db = getDb();
  const existing = getAutomationConfig(appId, automationKey);

  if (existing) {
    const setParts: string[] = [];
    const values: unknown[] = [];
    if (fields.enabled !== undefined) {
      setParts.push("enabled = ?");
      values.push(fields.enabled);
    }
    if (fields.cronExpression !== undefined) {
      setParts.push("cron_expression = ?");
      values.push(fields.cronExpression);
    }
    if (fields.configJson !== undefined) {
      setParts.push("config_json = ?");
      values.push(fields.configJson);
    }
    if (setParts.length === 0) return;
    setParts.push("updated_at = datetime('now')");
    values.push(appId, automationKey);
    db.prepare(
      `UPDATE automation_configs SET ${setParts.join(", ")} WHERE app_id = ? AND automation_key = ?`
    ).run(...values);
  } else {
    db.prepare(
      `INSERT INTO automation_configs (app_id, automation_key, enabled, cron_expression, config_json)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      appId,
      automationKey,
      fields.enabled ?? 1,
      fields.cronExpression ?? null,
      fields.configJson ?? "{}"
    );
  }
}

export function updateLastRunAt(appId: number, automationKey: string): void {
  // Use ISO format to match completed_at timestamps for consistent comparison
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE automation_configs SET last_run_at = ?, updated_at = datetime('now') WHERE app_id = ? AND automation_key = ?"
    )
    .run(now, appId, automationKey);
}

/**
 * Atomically try to acquire a lease for a given automation run window.
 * Uses INSERT OR IGNORE on the unique (app_id, automation_key, window_key) constraint.
 * Returns true if this caller acquired the lease; false if someone else already holds it.
 */
export function tryAcquireLease(appId: number, automationKey: string, windowKey: string, runId: number): boolean {
  const result = getDb()
    .prepare(
      "INSERT OR IGNORE INTO automation_leases (app_id, automation_key, window_key, run_id) VALUES (?, ?, ?, ?)"
    )
    .run(appId, automationKey, windowKey, runId);
  return result.changes > 0;
}

/**
 * Release a lease (cleanup after run completes).
 */
export function releaseLease(appId: number, automationKey: string, windowKey: string): void {
  getDb()
    .prepare("DELETE FROM automation_leases WHERE app_id = ? AND automation_key = ? AND window_key = ?")
    .run(appId, automationKey, windowKey);
}

/**
 * Clear all automation leases. Called on startup to recover from crashes
 * where the process died mid-run and never released its leases.
 */
export function clearAllLeases(): number {
  const result = getDb().prepare("DELETE FROM automation_leases").run();
  return result.changes;
}
