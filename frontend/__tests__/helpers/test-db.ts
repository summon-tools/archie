/**
 * Shared test database helper.
 * Creates isolated temp SQLite databases for integration tests.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { vi } from "vitest";

const DEFAULT_MOCK_CONFIG = {
  DB_PATH: "",
  DATA_DIR: "",
  UPLOADS_DIR: "",
  MODE: "development",
  AUTH_SECRET_KEY: "test-secret-for-tests-32chars!!!!!",
  HOST: "127.0.0.1",
  PORT: 8080,
  FORCE_SECURE_COOKIES: false,
  APP_PORT_START: 3001,
  PREVIEW_PORT_MIN: 9001,
  PREVIEW_PORT_MAX: 9050,
  CLAUDE_DANGEROUS_PERMISSIONS: true,
  getProjectsDir: () => "/tmp",
  getDefaultModel: () => "claude-sonnet-4-6",
  getDefaultProvider: () => "claude",
  getBackgroundModel: () => "claude-sonnet-4-6",
  getBackgroundProvider: () => "claude",
  getQuickModel: () => "claude-sonnet-4-6",
  getQuickProvider: () => "claude",
  getDemoModel: () => "claude-sonnet-4-6",
  getDemoProvider: () => "claude",
  getModelForCategory: () => ({ model: "claude-sonnet-4-6", provider: "claude" }),
};

export interface TestContext {
  tmpDir: string;
  dbPath: string;
  cleanup: () => void;
}

/** Create an isolated temp directory and DB path for a test. */
export function createTestContext(prefix = "archie-test-"): TestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tmpDir, "test.db");
  return {
    tmpDir,
    dbPath,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
    },
  };
}

/** Build a mock config object with optional overrides. */
export function mockConfig(dbPath: string, overrides?: Record<string, unknown>) {
  const dataDir = path.dirname(dbPath);
  return {
    ...DEFAULT_MOCK_CONFIG,
    DB_PATH: dbPath,
    DATA_DIR: dataDir,
    UPLOADS_DIR: path.join(dataDir, "uploads"),
    ...overrides,
  };
}

/**
 * Get an initialised test database.
 * Must be called after vi.resetModules().
 */
export async function getTestDb(ctx: TestContext) {
  vi.doMock("@/lib/server/config", () => mockConfig(ctx.dbPath, {
    getProjectsDir: () => ctx.tmpDir,
  }));
  const { getDb } = await import("@/lib/server/db");
  return getDb();
}
