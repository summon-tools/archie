import path from "path";
import Database from "better-sqlite3";

// process.cwd() in Next.js resolves to the frontend/ directory.
// Go up one level to reach the project root.
const PROJECT_ROOT = path.resolve(process.cwd(), "..");

export const MODE =
  process.env.ARCHIE_MODE || process.env.CLAUDIA_MODE || "development";
export const HOST = process.env.HOST || "127.0.0.1";
export const PORT = parseInt(process.env.PORT || "8080", 10);

// Paths
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const DB_PATH =
  process.env.DATABASE_PATH || path.join(DATA_DIR, "dashboard.db");

// Security
export const AUTH_SECRET_KEY = process.env.AUTH_SECRET_KEY || "";
export const FORCE_SECURE_COOKIES =
  (process.env.FORCE_SECURE_COOKIES || "false").toLowerCase() === "true";

// Claude
// Default to true — this tool is designed for controlled server environments
// where Claude Code needs full bash access to build/manage apps.
// Set CLAUDE_DANGEROUS_PERMISSIONS=false to restrict.
export const CLAUDE_DANGEROUS_PERMISSIONS =
  (process.env.CLAUDE_DANGEROUS_PERMISSIONS || "true").toLowerCase() !==
  "false";
// Port ranges
export const APP_PORT_START = parseInt(process.env.APP_PORT_START || "3001", 10);
export const PREVIEW_PORT_MIN = parseInt(process.env.PREVIEW_PORT_MIN || "9001", 10);
export const PREVIEW_PORT_MAX = parseInt(process.env.PREVIEW_PORT_MAX || "9050", 10);

// WebSocket server
export const WS_PORT = parseInt(process.env.WS_PORT || "8081", 10);

let _projectsDirCache: string | null = null;

export function getProjectsDir(): string {
  if (_projectsDirCache !== null) {
    return _projectsDirCache;
  }

  let result: string | undefined;

  // 1. Check DB setting (system_settings first, then legacy)
  try {
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'projects_dir'").get() as { value_json: string } | undefined;
    if (row) {
      try { const v = JSON.parse(row.value_json); if (v) result = v; } catch {}
    }
    if (!result) {
      const legacyRow = db.prepare("SELECT value FROM settings WHERE key = 'projects_dir'").get() as { value: string } | undefined;
      if (legacyRow?.value) result = legacyRow.value;
    }
    db.close();
  } catch {
    // DB may not exist yet
  }

  if (!result) {
    // 2. Check environment variable
    const envDir = process.env.PROJECTS_DIR;
    if (envDir) {
      result = envDir.startsWith("~")
        ? path.join(process.env.HOME || "", envDir.slice(1))
        : envDir;
    }
  }

  if (!result) {
    // 3. Default to home directory
    result = process.env.HOME || "/tmp";
  }

  _projectsDirCache = result;
  return result;
}

// --- Model Categories ---
//
// 4 categories for AI model usage:
//   chat       — main conversation with the user
//   background — knowledge indexing, brief generation, automation analysis
//   quick      — intent classification, commit messages, PR descriptions, task proposals
//   demo       — navigation scripts, walkthrough planning, seed scripts

export type ModelCategory = "chat" | "background" | "quick" | "demo";

const DEFAULT_MODEL_FALLBACK = "claude-opus-5";
const DEFAULT_PROVIDER_FALLBACK = "claude";

// --- Settings cache (avoid opening a DB connection per lookup) ---
// Invalidated explicitly via clearSettingsCache() after writes — no TTL expiry.

const _settingsCache = new Map<string, string | undefined>();

/** Clear cached settings — call after writes or on login so changes take effect immediately. */
export function clearSettingsCache(): void {
  _settingsCache.clear();
  _projectsDirCache = null;
}

function getSettingValue(key: string): string | undefined {
  if (_settingsCache.has(key)) return _settingsCache.get(key);

  let result: string | undefined;
  try {
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    // Try system_settings first, fall back to legacy settings table
    const row = db.prepare("SELECT value_json FROM system_settings WHERE key = ?").get(key) as { value_json: string } | undefined;
    if (row) {
      db.close();
      try { result = JSON.parse(row.value_json); } catch { result = row.value_json; }
      _settingsCache.set(key, result);
      return result;
    }
    const legacyRow = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    db.close();
    result = legacyRow?.value;
  } catch {
    result = undefined;
  }
  _settingsCache.set(key, result);
  return result;
}

// --- Chat (primary user-facing model) ---

export function getChatModel(): string {
  return getSettingValue("chat_model") || getSettingValue("default_model") || DEFAULT_MODEL_FALLBACK;
}

export function getChatProvider(): string {
  return getSettingValue("chat_provider") || getSettingValue("default_provider") || DEFAULT_PROVIDER_FALLBACK;
}

// --- Background (heavy async work: knowledge, briefs, automations) ---

export function getBackgroundModel(): string {
  return getSettingValue("background_model") || DEFAULT_MODEL_FALLBACK;
}

export function getBackgroundProvider(): string {
  return getSettingValue("background_provider") || DEFAULT_PROVIDER_FALLBACK;
}

// --- Quick (fast one-shot tasks: intent, commits, PR desc) ---

export function getQuickModel(): string {
  return getSettingValue("quick_model") || getChatModel();
}

export function getQuickProvider(): string {
  return getSettingValue("quick_provider") || getChatProvider();
}

// --- Demo (walkthrough, navigation scripts, seed scripts) ---

export function getDemoModel(): string {
  return getSettingValue("demo_model") || getChatModel();
}

export function getDemoProvider(): string {
  return getSettingValue("demo_provider") || getChatProvider();
}

// --- Convenience: resolve model+provider by category ---

export function getModelForCategory(category: ModelCategory): { model: string; provider: string } {
  switch (category) {
    case "chat":
      return { model: getChatModel(), provider: getChatProvider() };
    case "background":
      return { model: getBackgroundModel(), provider: getBackgroundProvider() };
    case "quick":
      return { model: getQuickModel(), provider: getQuickProvider() };
    case "demo":
      return { model: getDemoModel(), provider: getDemoProvider() };
  }
}

// --- Legacy aliases (keep for backward compat) ---

/** @deprecated Use getChatModel() */
export function getDefaultModel(): string {
  return getChatModel();
}

/** @deprecated Use getChatProvider() */
export function getDefaultProvider(): string {
  return getChatProvider();
}
