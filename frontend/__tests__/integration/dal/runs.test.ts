import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedRun } from "../../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-runs-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function loadDal() {
  return await import("@/lib/server/dal/runs");
}

describe("runs DAL", () => {
  it("createRun returns a run with defaults", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const run = dal.createRun({ app_id: app.id });
    expect(run.id).toBeDefined();
    expect(run.app_id).toBe(app.id);
    expect(run.status).toBe("running");
    expect(run.provider_id).toBe("claude");
  });

  it("createRun with custom fields", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const run = dal.createRun({
      app_id: app.id,
      workflow_key: "seed",
      status: "stopped",
      model_id: "claude-sonnet-4-6",
      progress_text: "Starting...",
    });
    expect(run.workflow_key).toBe("seed");
    expect(run.status).toBe("stopped");
    expect(run.model_id).toBe("claude-sonnet-4-6");
    expect(run.progress_text).toBe("Starting...");
  });

  it("getRun retrieves by id", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const run = dal.createRun({ app_id: app.id });
    const found = dal.getRun(run.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(run.id);
  });

  it("getRun returns undefined for missing id", async () => {
    const dal = await loadDal();
    expect(dal.getRun(999)).toBeUndefined();
  });

  it("updateRun changes status and fields", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const run = dal.createRun({ app_id: app.id });
    dal.updateRun(run.id, { status: "completed", result_json: '{"ok":true}' });
    const updated = dal.getRun(run.id)!;
    expect(updated.status).toBe("completed");
    expect(updated.result_json).toBe('{"ok":true}');
  });

  it("updateRun with empty fields is a no-op", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const run = dal.createRun({ app_id: app.id });
    dal.updateRun(run.id, {});
    const same = dal.getRun(run.id)!;
    expect(same.status).toBe("running");
  });

  it("heartbeatRun updates heartbeat_at", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const run = dal.createRun({ app_id: app.id });
    dal.heartbeatRun(run.id);
    const updated = dal.getRun(run.id)!;
    expect(updated.heartbeat_at).not.toBeNull();
  });

  it("getActiveRuns returns only running", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createRun({ app_id: app.id, status: "running" });
    dal.createRun({ app_id: app.id, status: "completed" });
    dal.createRun({ app_id: app.id, status: "running" });
    expect(dal.getActiveRuns()).toHaveLength(2);
  });

  it("getActiveRunsByApp filters by app", async () => {
    const dal = await loadDal();
    const app1 = seedApp(db, { name: "App 1", port: 3001 });
    const app2 = seedApp(db, { name: "App 2", port: 3002 });
    dal.createRun({ app_id: app1.id });
    dal.createRun({ app_id: app2.id });
    expect(dal.getActiveRunsByApp(app1.id)).toHaveLength(1);
    expect(dal.getActiveRunsByApp(app2.id)).toHaveLength(1);
  });

  it("getActiveRunByWorkflow finds matching run", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createRun({ app_id: app.id, workflow_key: "seed" });
    dal.createRun({ app_id: app.id, workflow_key: "stream" });
    const found = dal.getActiveRunByWorkflow(app.id, "seed");
    expect(found).toBeDefined();
    expect(found!.workflow_key).toBe("seed");
  });

  it("getActiveRunByWorkflow returns undefined when none match", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    expect(dal.getActiveRunByWorkflow(app.id, "nonexistent")).toBeUndefined();
  });

  it("markInterruptedRuns marks running as failed", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createRun({ app_id: app.id, status: "running" });
    dal.createRun({ app_id: app.id, status: "running" });
    dal.createRun({ app_id: app.id, status: "completed" });
    const count = dal.markInterruptedRuns();
    expect(count).toBe(2);
    expect(dal.getActiveRuns()).toHaveLength(0);
    // Verify failure_category
    const runs = db.prepare("SELECT * FROM runs WHERE failure_category = 'interrupted'").all();
    expect(runs).toHaveLength(2);
  });

  it("markInterruptedRuns returns 0 when no running runs", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createRun({ app_id: app.id, status: "completed" });
    expect(dal.markInterruptedRuns()).toBe(0);
  });
});
