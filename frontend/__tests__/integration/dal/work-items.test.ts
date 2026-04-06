import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedConversation, seedUser } from "../../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-work-items-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function loadDal() {
  return await import("@/lib/server/dal/work-items");
}

describe("work-items DAL", () => {
  it("createWorkItem returns a work item with auto-position", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = dal.createWorkItem({ app_id: app.id, primary_conversation_id: conversation.id, title: "Task 1" });
    expect(wi.id).toBeDefined();
    expect(wi.title).toBe("Task 1");
    expect(wi.position).toBe(0);
    expect(wi.kind).toBe("task");
    expect(wi.status).toBe("in_progress");
  });

  it("auto-position increments", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const c1 = seedConversation(db, app.id, { title: "C1" });
    const c2 = seedConversation(db, app.id, { title: "C2" });
    const wi1 = dal.createWorkItem({ app_id: app.id, primary_conversation_id: c1.id, title: "First" });
    const wi2 = dal.createWorkItem({ app_id: app.id, primary_conversation_id: c2.id, title: "Second" });
    expect(wi1.position).toBe(0);
    expect(wi2.position).toBe(1);
  });

  it("getWorkItem retrieves by id", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = dal.createWorkItem({ app_id: app.id, primary_conversation_id: conversation.id, title: "WI" });
    expect(dal.getWorkItem(wi.id)).toBeDefined();
    expect(dal.getWorkItem(wi.id)!.title).toBe("WI");
  });

  it("getWorkItem returns undefined for missing", async () => {
    const dal = await loadDal();
    expect(dal.getWorkItem(999)).toBeUndefined();
  });

  it("getWorkItemsByApp joins creator info", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const user = seedUser(db, { name: "Bob" });
    const conversation = seedConversation(db, app.id);
    dal.createWorkItem({ app_id: app.id, primary_conversation_id: conversation.id, title: "WI", created_by: user.id });
    const items = dal.getWorkItemsByApp(app.id);
    expect(items).toHaveLength(1);
    expect(items[0].created_by_name).toBe("Bob");
  });

  it("getWorkItemByConversationId finds by conversation", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    dal.createWorkItem({ app_id: app.id, primary_conversation_id: conversation.id, title: "WI" });
    const found = dal.getWorkItemByConversationId(conversation.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe("WI");
  });

  it("updateWorkItem changes fields", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = dal.createWorkItem({ app_id: app.id, primary_conversation_id: conversation.id, title: "Old" });
    dal.updateWorkItem(wi.id, { title: "New", status: "done" });
    const updated = dal.getWorkItem(wi.id)!;
    expect(updated.title).toBe("New");
    expect(updated.status).toBe("done");
  });

  it("deleteWorkItem removes item and cleans up children", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = dal.createWorkItem({ app_id: app.id, primary_conversation_id: conversation.id, title: "WI" });
    // Add env and artifact
    dal.ensureWorkItemEnv(wi.id);
    db.prepare("INSERT INTO artifacts (app_id, work_item_id, kind) VALUES (?, ?, ?)").run(app.id, wi.id, "diff");
    dal.deleteWorkItem(wi.id);
    expect(dal.getWorkItem(wi.id)).toBeUndefined();
    expect(dal.getWorkItemEnv(wi.id)).toBeUndefined();
    const artifacts = db.prepare("SELECT * FROM artifacts WHERE work_item_id = ?").all(wi.id);
    expect(artifacts).toHaveLength(0);
  });

  it("ensureWorkItemEnv creates env row", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = dal.createWorkItem({ app_id: app.id, primary_conversation_id: conversation.id, title: "WI" });
    expect(dal.getWorkItemEnv(wi.id)).toBeUndefined();
    dal.ensureWorkItemEnv(wi.id);
    expect(dal.getWorkItemEnv(wi.id)).toBeDefined();
  });

  it("ensureWorkItemEnv is idempotent", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = dal.createWorkItem({ app_id: app.id, primary_conversation_id: conversation.id, title: "WI" });
    dal.ensureWorkItemEnv(wi.id);
    dal.ensureWorkItemEnv(wi.id); // should not throw
    expect(dal.getWorkItemEnv(wi.id)).toBeDefined();
  });

  it("updateWorkItemEnv sets fields", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = dal.createWorkItem({ app_id: app.id, primary_conversation_id: conversation.id, title: "WI" });
    dal.updateWorkItemEnv(wi.id, { branch_name: "feature/test", worktree_dir: "/tmp/wt" });
    const env = dal.getWorkItemEnv(wi.id)!;
    expect(env.branch_name).toBe("feature/test");
    expect(env.worktree_dir).toBe("/tmp/wt");
  });

  it("getWorkItemCounts groups by status", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const c1 = seedConversation(db, app.id, { title: "C1" });
    const c2 = seedConversation(db, app.id, { title: "C2" });
    const c3 = seedConversation(db, app.id, { title: "C3" });
    dal.createWorkItem({ app_id: app.id, primary_conversation_id: c1.id, title: "A" });
    dal.createWorkItem({ app_id: app.id, primary_conversation_id: c2.id, title: "B" });
    const wi3 = dal.createWorkItem({ app_id: app.id, primary_conversation_id: c3.id, title: "C" });
    dal.updateWorkItem(wi3.id, { status: "done" });
    const counts = dal.getWorkItemCounts(app.id);
    expect(counts.in_progress).toBe(2);
    expect(counts.done).toBe(1);
  });

  it("getWorkItemCounts returns zeros for empty app", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const counts = dal.getWorkItemCounts(app.id);
    expect(counts.in_progress).toBe(0);
    expect(counts.done).toBe(0);
  });
});
