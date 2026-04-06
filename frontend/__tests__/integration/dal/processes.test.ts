import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedConversation, seedWorkItem } from "../../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-processes-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function loadDal() {
  return await import("@/lib/server/dal/processes");
}

describe("processes DAL", () => {
  it("registerProcess returns process row", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const proc = dal.registerProcess({ app_id: app.id, kind: "preview", pid: 1234, port: 9001 });
    expect(proc.id).toBeDefined();
    expect(proc.kind).toBe("preview");
    expect(proc.pid).toBe(1234);
    expect(proc.port).toBe(9001);
    expect(proc.status).toBe("running");
  });

  it("getProcess retrieves by id", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const proc = dal.registerProcess({ app_id: app.id, kind: "preview" });
    expect(dal.getProcess(proc.id)).toBeDefined();
    expect(dal.getProcess(proc.id)!.kind).toBe("preview");
  });

  it("getProcess returns undefined for missing", async () => {
    const dal = await loadDal();
    expect(dal.getProcess(999)).toBeUndefined();
  });

  it("getActiveProcess finds running process for app+kind", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.registerProcess({ app_id: app.id, kind: "preview", pid: 1000 });
    const active = dal.getActiveProcess(app.id, "preview");
    expect(active).toBeDefined();
    expect(active!.pid).toBe(1000);
  });

  it("getActiveProcess returns undefined when stopped", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const proc = dal.registerProcess({ app_id: app.id, kind: "preview" });
    dal.updateProcessStatus(proc.id, "stopped");
    expect(dal.getActiveProcess(app.id, "preview")).toBeUndefined();
  });

  it("getActiveProcess filters by work_item_id", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const wi = seedWorkItem(db, app.id, conversation.id);
    dal.registerProcess({ app_id: app.id, kind: "preview", work_item_id: wi.id });
    dal.registerProcess({ app_id: app.id, kind: "preview" }); // app-level
    expect(dal.getActiveProcess(app.id, "preview", wi.id)).toBeDefined();
    expect(dal.getActiveProcess(app.id, "preview")).toBeDefined(); // app-level (null work_item_id)
  });

  it("updateProcessStatus sets stopped_at for non-running", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const proc = dal.registerProcess({ app_id: app.id, kind: "preview" });
    dal.updateProcessStatus(proc.id, "stopped");
    const updated = dal.getProcess(proc.id)!;
    expect(updated.status).toBe("stopped");
    expect(updated.stopped_at).not.toBeNull();
  });

  it("listProcesses returns all for app", async () => {
    const dal = await loadDal();
    const app1 = seedApp(db, { name: "A1", port: 3001 });
    const app2 = seedApp(db, { name: "A2", port: 3002 });
    dal.registerProcess({ app_id: app1.id, kind: "preview" });
    dal.registerProcess({ app_id: app1.id, kind: "custom" });
    dal.registerProcess({ app_id: app2.id, kind: "preview" });
    expect(dal.listProcesses(app1.id)).toHaveLength(2);
    expect(dal.listProcesses(app2.id)).toHaveLength(1);
  });
});
