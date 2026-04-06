import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedConversation, seedWorkItem } from "../../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-artifacts-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function loadDal() {
  return await import("@/lib/server/dal/artifacts");
}

describe("artifacts DAL", () => {
  it("createArtifact returns artifact with defaults", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = seedWorkItem(db, app.id, conversation.id);
    const art = dal.createArtifact({ app_id: app.id, work_item_id: wi.id, kind: "diff" });
    expect(art.id).toBeDefined();
    expect(art.kind).toBe("diff");
    expect(art.storage_type).toBe("inline");
  });

  it("getArtifact retrieves by id", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const art = dal.createArtifact({ app_id: app.id, kind: "log", inline_text: "hello" });
    const found = dal.getArtifact(art.id);
    expect(found).toBeDefined();
    expect(found!.inline_text).toBe("hello");
  });

  it("getArtifact returns undefined for missing", async () => {
    const dal = await loadDal();
    expect(dal.getArtifact(999)).toBeUndefined();
  });

  it("getArtifacts filters by work_item_id", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi1 = seedWorkItem(db, app.id, conversation.id, { title: "WI1" });
    const c2 = seedConversation(db, app.id, { title: "C2" });
    const wi2 = seedWorkItem(db, app.id, c2.id, { title: "WI2" });
    dal.createArtifact({ app_id: app.id, work_item_id: wi1.id, kind: "diff" });
    dal.createArtifact({ app_id: app.id, work_item_id: wi2.id, kind: "diff" });
    expect(dal.getArtifacts(wi1.id)).toHaveLength(1);
  });

  it("getArtifacts filters by kind", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = seedWorkItem(db, app.id, conversation.id);
    dal.createArtifact({ app_id: app.id, work_item_id: wi.id, kind: "diff" });
    dal.createArtifact({ app_id: app.id, work_item_id: wi.id, kind: "log" });
    expect(dal.getArtifacts(wi.id, "diff")).toHaveLength(1);
  });

  it("getArtifactByKind returns latest", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = seedWorkItem(db, app.id, conversation.id);
    dal.createArtifact({ app_id: app.id, work_item_id: wi.id, kind: "diff", inline_text: "old" });
    dal.createArtifact({ app_id: app.id, work_item_id: wi.id, kind: "diff", inline_text: "new" });
    const latest = dal.getArtifactByKind(wi.id, "diff");
    expect(latest).toBeDefined();
    expect(latest!.inline_text).toBe("new");
  });

  it("deleteArtifact removes single artifact", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const art = dal.createArtifact({ app_id: app.id, kind: "log" });
    dal.deleteArtifact(art.id);
    expect(dal.getArtifact(art.id)).toBeUndefined();
  });

  it("deleteArtifactsByKind removes all of kind for work item", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = seedWorkItem(db, app.id, conversation.id);
    dal.createArtifact({ app_id: app.id, work_item_id: wi.id, kind: "diff" });
    dal.createArtifact({ app_id: app.id, work_item_id: wi.id, kind: "diff" });
    dal.createArtifact({ app_id: app.id, work_item_id: wi.id, kind: "log" });
    dal.deleteArtifactsByKind(wi.id, "diff");
    expect(dal.getArtifacts(wi.id, "diff")).toHaveLength(0);
    expect(dal.getArtifacts(wi.id, "log")).toHaveLength(1);
  });

  it("getAppArtifacts returns only app-level (null work_item_id)", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = seedWorkItem(db, app.id, conversation.id);
    dal.createArtifact({ app_id: app.id, work_item_id: wi.id, kind: "diff" });
    dal.createArtifact({ app_id: app.id, kind: "diff", inline_text: "app-level" });
    const appArts = dal.getAppArtifacts(app.id, "diff");
    expect(appArts).toHaveLength(1);
    expect(appArts[0].inline_text).toBe("app-level");
  });

  it("getAppArtifactByTopic uses json_extract", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createArtifact({
      app_id: app.id,
      kind: "app_knowledge",
      metadata_json: JSON.stringify({ topic: "architecture" }),
      inline_text: "Monolith",
    });
    const found = dal.getAppArtifactByTopic(app.id, "architecture");
    expect(found).toBeDefined();
    expect(found!.inline_text).toBe("Monolith");
  });

  it("getAppArtifactByTopic returns undefined for missing topic", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    expect(dal.getAppArtifactByTopic(app.id, "nonexistent")).toBeUndefined();
  });

  it("deleteAppArtifactsByTopic removes matching artifacts", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createArtifact({
      app_id: app.id,
      kind: "app_knowledge",
      metadata_json: JSON.stringify({ topic: "arch" }),
    });
    dal.createArtifact({
      app_id: app.id,
      kind: "app_knowledge",
      metadata_json: JSON.stringify({ topic: "other" }),
    });
    dal.deleteAppArtifactsByTopic(app.id, "arch");
    expect(dal.getAppArtifactByTopic(app.id, "arch")).toBeUndefined();
    expect(dal.getAppArtifactByTopic(app.id, "other")).toBeDefined();
  });

  it("getArtifactsByAppAndKind respects limit", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    for (let i = 0; i < 5; i++) {
      dal.createArtifact({ app_id: app.id, kind: "log", inline_text: `log-${i}` });
    }
    expect(dal.getArtifactsByAppAndKind(app.id, "log", 3)).toHaveLength(3);
    expect(dal.getArtifactsByAppAndKind(app.id, "log")).toHaveLength(5);
  });

  it("getLatestAppArtifact returns most recent", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createArtifact({ app_id: app.id, kind: "log", inline_text: "first" });
    dal.createArtifact({ app_id: app.id, kind: "log", inline_text: "second" });
    const latest = dal.getLatestAppArtifact(app.id, "log");
    expect(latest).toBeDefined();
    expect(latest!.inline_text).toBe("second");
  });
});
