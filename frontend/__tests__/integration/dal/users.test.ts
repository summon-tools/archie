import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-users-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function loadDal() {
  return await import("@/lib/server/dal/users");
}

describe("users DAL", () => {
  it("createUser returns user row with defaults", async () => {
    const dal = await loadDal();
    const user = dal.createUser({ username: "alice", password_hash: "hash", name: "Alice" });
    expect(user.id).toBeDefined();
    expect(user.username).toBe("alice");
    expect(user.role).toBe("member");
  });

  it("createUser with custom fields", async () => {
    const dal = await loadDal();
    const user = dal.createUser({
      username: "bob",
      password_hash: "hash",
      name: "Bob",
      role: "admin",
      email: "bob@test.com",
      color: "#ff0000",
    });
    expect(user.role).toBe("admin");
    expect(user.email).toBe("bob@test.com");
    expect(user.color).toBe("#ff0000");
  });

  it("getUser retrieves by id", async () => {
    const dal = await loadDal();
    const user = dal.createUser({ username: "alice", password_hash: "hash", name: "Alice" });
    expect(dal.getUser(user.id)!.username).toBe("alice");
  });

  it("getUser returns undefined for missing", async () => {
    const dal = await loadDal();
    expect(dal.getUser(999)).toBeUndefined();
  });

  it("getUserByUsername finds user", async () => {
    const dal = await loadDal();
    dal.createUser({ username: "alice", password_hash: "hash", name: "Alice" });
    expect(dal.getUserByUsername("alice")).toBeDefined();
    expect(dal.getUserByUsername("nonexistent")).toBeUndefined();
  });

  it("getUserByEmail finds user", async () => {
    const dal = await loadDal();
    dal.createUser({ username: "alice", password_hash: "hash", name: "Alice", email: "alice@test.com" });
    expect(dal.getUserByEmail("alice@test.com")).toBeDefined();
    expect(dal.getUserByEmail("nope@test.com")).toBeUndefined();
  });

  it("getUsers returns all (excluding system users)", async () => {
    const dal = await loadDal();
    dal.createUser({ username: "a", password_hash: "h", name: "A" });
    dal.createUser({ username: "b", password_hash: "h", name: "B" });
    expect(dal.getUsers()).toHaveLength(2);
  });

  it("getActiveUsers excludes soft-deleted and system users", async () => {
    const dal = await loadDal();
    dal.createUser({ username: "a", password_hash: "h", name: "A" });
    const b = dal.createUser({ username: "b", password_hash: "h", name: "B" });
    dal.updateUser(b.id, { deleted_at: new Date().toISOString() });
    expect(dal.getActiveUsers()).toHaveLength(1);
    expect(dal.getUsers()).toHaveLength(2);
  });

  it("updateUser changes fields", async () => {
    const dal = await loadDal();
    const user = dal.createUser({ username: "alice", password_hash: "hash", name: "Alice" });
    dal.updateUser(user.id, { name: "Alice Updated", role: "admin" });
    const updated = dal.getUser(user.id)!;
    expect(updated.name).toBe("Alice Updated");
    expect(updated.role).toBe("admin");
  });
});

describe("settings helpers", () => {
  it("setSetting and getSetting round-trip", async () => {
    const dal = await loadDal();
    dal.setSetting("theme", "dark");
    expect(dal.getSetting("theme")).toBe("dark");
  });

  it("getSetting returns null for missing key", async () => {
    const dal = await loadDal();
    expect(dal.getSetting("nonexistent")).toBeNull();
  });

  it("setSetting handles complex JSON values", async () => {
    const dal = await loadDal();
    dal.setSetting("config", { key: "value", nested: { a: 1 } });
    const result = dal.getSetting("config") as any;
    expect(result.key).toBe("value");
    expect(result.nested.a).toBe(1);
  });

  it("setSetting upserts (replaces existing)", async () => {
    const dal = await loadDal();
    dal.setSetting("theme", "dark");
    dal.setSetting("theme", "light");
    expect(dal.getSetting("theme")).toBe("light");
  });

  it("deleteSetting removes key", async () => {
    const dal = await loadDal();
    dal.setSetting("theme", "dark");
    expect(dal.deleteSetting("theme")).toBe(true);
    expect(dal.getSetting("theme")).toBeNull();
  });

  it("deleteSetting returns false for missing key", async () => {
    const dal = await loadDal();
    expect(dal.deleteSetting("nonexistent")).toBe(false);
  });

  it("getAllSettings returns all entries", async () => {
    const dal = await loadDal();
    dal.setSetting("a", "one");
    dal.setSetting("b", "two");
    const all = dal.getAllSettings();
    expect(all.a).toBe("one");
    expect(all.b).toBe("two");
  });
});
