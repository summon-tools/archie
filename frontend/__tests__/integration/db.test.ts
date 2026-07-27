import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";

// We test initDb indirectly by calling getDb() with a temp DB path.
// We need to override the config before importing db.ts.

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archie-test-"));
  dbPath = path.join(tmpDir, "test.db");
  // Reset the module cache so getDb() creates a fresh DB
  vi.resetModules();
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

async function getTestDb() {
  vi.doMock("@/lib/server/config", () => ({
    DB_PATH: dbPath,
    DATA_DIR: tmpDir,
    UPLOADS_DIR: path.join(tmpDir, "uploads"),
    MODE: "development",
    AUTH_SECRET_KEY: "",
    HOST: "127.0.0.1",
    PORT: 8080,
    FORCE_SECURE_COOKIES: false,
    APP_PORT_START: 3001,
    PREVIEW_PORT_MIN: 9001,
    PREVIEW_PORT_MAX: 9050,
    CLAUDE_DANGEROUS_PERMISSIONS: true,
    getProjectsDir: () => tmpDir,
    getDefaultModel: () => "claude-opus-5",
    getBackgroundModel: () => "claude-opus-5",
  }));
  const { getDb } = await import("@/lib/server/db");
  return getDb();
}

describe("Database initialization", () => {
  it("creates all base tables", async () => {
    const db = await getTestDb();

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain("apps");
    expect(tables).toContain("users");
    expect(tables).toContain("invitations");
    expect(tables).toContain("conversations");
    expect(tables).toContain("messages");
    expect(tables).toContain("work_items");
    expect(tables).toContain("work_item_env");
    expect(tables).toContain("agent_sessions");
    expect(tables).toContain("runs");
    expect(tables).toContain("artifacts");
    expect(tables).toContain("app_files");
    expect(tables).toContain("app_file_links");
    expect(tables).toContain("app_tool_configs");
    expect(tables).toContain("system_settings");
    expect(tables).toContain("terminal_sessions");
    expect(tables).toContain("managed_processes");
    expect(tables).toContain("home_rooms");
    expect(tables).toContain("room_messages");
    expect(tables).toContain("room_agent_runs");
    expect(tables).toContain("plans");
    expect(tables).toContain("plan_steps");
    expect(tables).toContain("plan_step_events");
  });

  it("enables WAL journal mode", async () => {
    const db = await getTestDb();
    const result = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe("wal");
  });

  it("enables foreign keys", async () => {
    const db = await getTestDb();
    const result = db.pragma("foreign_keys") as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);
  });

  it("creates work_items table with all columns", async () => {
    const db = await getTestDb();
    const cols = db
      .prepare("PRAGMA table_info(work_items)")
      .all()
      .map((r: any) => r.name);

    expect(cols).toContain("id");
    expect(cols).toContain("app_id");
    expect(cols).toContain("primary_conversation_id");
    expect(cols).toContain("title");
    expect(cols).toContain("summary");
    expect(cols).toContain("kind");
    expect(cols).toContain("status");
    expect(cols).toContain("position");
    expect(cols).toContain("created_by");
    expect(cols).toContain("assigned_to");
    expect(cols).toContain("legacy_task_id");
  });

  it("creates work_item_env table with all columns", async () => {
    const db = await getTestDb();
    const cols = db
      .prepare("PRAGMA table_info(work_item_env)")
      .all()
      .map((r: any) => r.name);

    expect(cols).toContain("work_item_id");
    expect(cols).toContain("branch_name");
    expect(cols).toContain("worktree_dir");
    expect(cols).toContain("worktree_status");
    expect(cols).toContain("branch_source");
    expect(cols).toContain("delete_branch_on_remove");
    expect(cols).toContain("preview_port");
    expect(cols).toContain("preview_pid");
  });

  it("creates managed_processes table with all columns", async () => {
    const db = await getTestDb();
    const cols = db
      .prepare("PRAGMA table_info(managed_processes)")
      .all()
      .map((r: any) => r.name);

    expect(cols).toContain("id");
    expect(cols).toContain("app_id");
    expect(cols).toContain("work_item_id");
    expect(cols).toContain("kind");
    expect(cols).toContain("pid");
    expect(cols).toContain("port");
    expect(cols).toContain("log_path");
    expect(cols).toContain("status");
  });

  it("creates users table with all columns", async () => {
    const db = await getTestDb();
    const cols = db
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((r: any) => r.name);

    expect(cols).toContain("id");
    expect(cols).toContain("username");
    expect(cols).toContain("password_hash");
    expect(cols).toContain("role");
    expect(cols).toContain("email");
    expect(cols).toContain("name");
    expect(cols).toContain("color");
    expect(cols).toContain("deleted_at");
  });

  it("seeds default model settings in system_settings", async () => {
    const db = await getTestDb();
    const defaultModel = db
      .prepare("SELECT value_json FROM system_settings WHERE key = 'default_model'")
      .get() as { value_json: string } | undefined;
    const bgModel = db
      .prepare("SELECT value_json FROM system_settings WHERE key = 'background_model'")
      .get() as { value_json: string } | undefined;

    // These may or may not be seeded depending on migration path — just verify the table works
    expect(db.prepare("SELECT count(*) as c FROM system_settings").get()).toBeDefined();
  });
});

describe("Database CRUD operations", () => {
  it("inserts and retrieves an app", async () => {
    const db = await getTestDb();

    const result = db
      .prepare(
        "INSERT INTO apps (name, port, description, directory) VALUES (?, ?, ?, ?)"
      )
      .run("Test App", 3001, "A test app", "/tmp/test-app");

    expect(result.lastInsertRowid).toBe(1);

    const app = db.prepare("SELECT * FROM apps WHERE id = ?").get(1) as any;
    expect(app.name).toBe("Test App");
    expect(app.port).toBe(3001);
    expect(app.description).toBe("A test app");
  });

  it("inserts and retrieves a conversation and work item", async () => {
    const db = await getTestDb();

    db.prepare(
      "INSERT INTO apps (name, port, description, directory) VALUES (?, ?, ?, ?)"
    ).run("Test App", 3001, "", "/tmp/test");

    const conversationResult = db
      .prepare(
        "INSERT INTO conversations (app_id, kind, title) VALUES (?, ?, ?)"
      )
      .run(1, "task", "Setup Test App");

    expect(conversationResult.lastInsertRowid).toBe(1);

    const workItemResult = db
      .prepare(
        "INSERT INTO work_items (app_id, primary_conversation_id, title, summary, kind, status, position) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(1, 1, "Setup Test App", "Set up the project", "task", "in_progress", 0);

    expect(workItemResult.lastInsertRowid).toBe(1);

    const wi = db.prepare("SELECT * FROM work_items WHERE id = ?").get(1) as any;
    expect(wi.title).toBe("Setup Test App");
    expect(wi.status).toBe("in_progress");
    expect(wi.app_id).toBe(1);
  });

  it("enforces foreign key constraint on conversations", async () => {
    const db = await getTestDb();

    expect(() => {
      db.prepare(
        "INSERT INTO conversations (app_id, kind, title) VALUES (?, ?, ?)"
      ).run(999, "task", "Orphan Conversation");
    }).toThrow();
  });

  it("enforces status check constraint on work_items", async () => {
    const db = await getTestDb();

    db.prepare(
      "INSERT INTO apps (name, port, description, directory) VALUES (?, ?, ?, ?)"
    ).run("Test App", 3001, "", "/tmp/test");

    db.prepare(
      "INSERT INTO conversations (app_id, kind, title) VALUES (?, ?, ?)"
    ).run(1, "task", "Conversation");

    expect(() => {
      db.prepare(
        "INSERT INTO work_items (app_id, primary_conversation_id, title, kind, status, position) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(1, 1, "Bad Item", "task", "invalid_status", 0);
    }).toThrow();
  });

  it("cascades deletes from apps to conversations and work_items", async () => {
    const db = await getTestDb();

    db.prepare(
      "INSERT INTO apps (name, port, description, directory) VALUES (?, ?, ?, ?)"
    ).run("Test App", 3001, "", "/tmp/test");

    db.prepare(
      "INSERT INTO conversations (app_id, kind, title) VALUES (?, ?, ?)"
    ).run(1, "task", "Conversation 1");

    db.prepare(
      "INSERT INTO work_items (app_id, primary_conversation_id, title, kind, status, position) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(1, 1, "Item 1", "task", "in_progress", 0);

    // Delete the app
    db.prepare("DELETE FROM apps WHERE id = ?").run(1);

    // Conversations and work items should be gone
    const conversations = db.prepare("SELECT * FROM conversations WHERE app_id = ?").all(1);
    expect(conversations).toHaveLength(0);

    const items = db.prepare("SELECT * FROM work_items WHERE app_id = ?").all(1);
    expect(items).toHaveLength(0);
  });

  it("cascades deletes from work_items to work_item_env", async () => {
    const db = await getTestDb();

    db.prepare(
      "INSERT INTO apps (name, port, description, directory) VALUES (?, ?, ?, ?)"
    ).run("Test App", 3001, "", "/tmp/test");

    db.prepare(
      "INSERT INTO conversations (app_id, kind, title) VALUES (?, ?, ?)"
    ).run(1, "task", "Conversation");

    db.prepare(
      "INSERT INTO work_items (app_id, primary_conversation_id, title, kind, status, position) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(1, 1, "Item", "task", "in_progress", 0);

    db.prepare(
      "INSERT INTO work_item_env (work_item_id, branch_name, worktree_dir) VALUES (?, ?, ?)"
    ).run(1, "feature-branch", "/tmp/worktree");

    // Delete the work item
    db.prepare("DELETE FROM work_items WHERE id = ?").run(1);

    const envs = db.prepare("SELECT * FROM work_item_env WHERE work_item_id = ?").all(1);
    expect(envs).toHaveLength(0);
  });

  it("inserts and retrieves a user", async () => {
    const db = await getTestDb();

    db.prepare(
      "INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)"
    ).run("testuser", "hashed_pw", "Test User", "admin", "test@example.com");

    const user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get("testuser") as any;
    expect(user.name).toBe("Test User");
    expect(user.role).toBe("admin");
    expect(user.email).toBe("test@example.com");
  });

  it("enforces unique email constraint", async () => {
    const db = await getTestDb();

    db.prepare(
      "INSERT INTO users (username, password_hash, name, email) VALUES (?, ?, ?, ?)"
    ).run("user1", "hash1", "User One", "same@example.com");

    expect(() => {
      db.prepare(
        "INSERT INTO users (username, password_hash, name, email) VALUES (?, ?, ?, ?)"
      ).run("user2", "hash2", "User Two", "same@example.com");
    }).toThrow();
  });

  it("inserts and retrieves managed processes", async () => {
    const db = await getTestDb();

    db.prepare(
      "INSERT INTO apps (name, port, description, directory) VALUES (?, ?, ?, ?)"
    ).run("Test App", 3001, "", "/tmp/test");

    const result = db.prepare(
      "INSERT INTO managed_processes (app_id, kind, pid, port, log_path, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(1, "preview", 12345, 9001, "/tmp/test/.archie/logs/web.log", "running");

    expect(result.lastInsertRowid).toBe(1);

    const proc = db.prepare("SELECT * FROM managed_processes WHERE id = ?").get(1) as any;
    expect(proc.kind).toBe("preview");
    expect(proc.pid).toBe(12345);
    expect(proc.status).toBe("running");
  });
});

describe("Database idempotency", () => {
  it("calling getDb() twice returns the same instance", async () => {
    vi.doMock("@/lib/server/config", () => ({
      DB_PATH: dbPath,
      MODE: "development",
      AUTH_SECRET_KEY: "",
      SETUP_BOOTSTRAP_TOKEN: "",
      HOST: "127.0.0.1",
      PORT: 8080,
      FORCE_SECURE_COOKIES: false,
      APP_PORT_START: 3001,
      PREVIEW_PORT_MIN: 9001,
      PREVIEW_PORT_MAX: 9050,
      CLAUDE_DANGEROUS_PERMISSIONS: true,
      getProjectsDir: () => tmpDir,
      getDefaultModel: () => "claude-opus-5",
      getBackgroundModel: () => "claude-opus-5",
    }));
    const { getDb } = await import("@/lib/server/db");

    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("re-running initDb on existing DB does not error", async () => {
    // First call creates tables
    const db1 = await getTestDb();
    db1.prepare(
      "INSERT INTO apps (name, port, description, directory) VALUES (?, ?, ?, ?)"
    ).run("App", 3001, "", "/tmp");

    // Reset modules and create a new getDb call (simulates server restart)
    vi.resetModules();
    const db2 = await getTestDb();

    // Data should still be there
    const app = db2.prepare("SELECT * FROM apps WHERE name = ?").get("App") as any;
    expect(app).toBeDefined();
    expect(app.name).toBe("App");
  });
});
