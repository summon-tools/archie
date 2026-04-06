import fs from "fs";
import path from "path";

const ARCHIE_DIR = ".archie";

/**
 * Resolve a script path with legacy fallback.
 * Checks .archie/<name> first, then falls back to root <name>.
 */
export function resolveScriptPath(dir: string, name: string): string | null {
  const newPath = path.join(dir, ARCHIE_DIR, name);
  if (fs.existsSync(newPath)) return newPath;
  const legacyPath = path.join(dir, name);
  if (fs.existsSync(legacyPath)) return legacyPath;
  return null;
}

/**
 * Get the write path for a script — always under .archie/.
 */
export function getScriptWritePath(dir: string, name: string): string {
  return path.join(dir, ARCHIE_DIR, name);
}

/**
 * Resolve logs directory with legacy fallback.
 */
export function resolveLogsDir(dir: string): string {
  const newPath = path.join(dir, ARCHIE_DIR, "logs");
  if (fs.existsSync(newPath)) return newPath;
  const legacyPath = path.join(dir, ".logs");
  if (fs.existsSync(legacyPath)) return legacyPath;
  return newPath; // default to new path
}

/**
 * Resolve pids directory with legacy fallback.
 */
export function resolvePidsDir(dir: string): string {
  const newPath = path.join(dir, ARCHIE_DIR, "pids");
  if (fs.existsSync(newPath)) return newPath;
  const legacyPath = path.join(dir, ".pids");
  if (fs.existsSync(legacyPath)) return legacyPath;
  return newPath; // default to new path
}

/**
 * Ensure .archie/logs/ and .archie/pids/ directories exist.
 */
export function ensureArchieDir(dir: string): void {
  fs.mkdirSync(path.join(dir, ARCHIE_DIR, "logs"), { recursive: true });
  fs.mkdirSync(path.join(dir, ARCHIE_DIR, "pids"), { recursive: true });
}
