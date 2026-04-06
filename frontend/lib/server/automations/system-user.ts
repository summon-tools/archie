import { getDb } from "../db";

let _cachedId: number | null = null;

/**
 * Get the ID of the synthetic Archie Automation user.
 * This user is created at DB init time by ensureAutomationUser().
 */
export function getAutomationUserId(): number {
  if (_cachedId !== null) return _cachedId;
  const row = getDb()
    .prepare("SELECT id FROM users WHERE username = '__archie_automation__'")
    .get() as { id: number } | undefined;
  if (!row) {
    throw new Error("Archie Automation user not found — DB may not be initialized");
  }
  _cachedId = row.id;
  return _cachedId;
}
