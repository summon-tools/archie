import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedConversation, seedWorkItem } from "../../helpers/seed";

let ctx: TestContext;
const checkPortSync = vi.fn(() => { throw new Error("Unexpected per-port process"); });

beforeEach(() => {
  vi.resetModules();
  checkPortSync.mockClear();
  vi.doMock("@/lib/server/apps", () => ({ checkPortSync }));
  ctx = createTestContext("app-port-snapshot-");
});
afterEach(() => { ctx.cleanup(); });

it("uses one socket snapshot for app and preview counts without per-port subprocesses", async () => {
  const db = await getTestDb(ctx);
  const app = seedApp(db);
  const conversation = seedConversation(db, app.id);
  for (const previewPort of [9001, 9002, 9003]) {
    const workItem = seedWorkItem(db, app.id, conversation.id);
    db.prepare("INSERT INTO work_item_env (work_item_id, preview_port) VALUES (?, ?)").run(workItem.id, previewPort);
  }
  const { getApp, buildAppResponse } = await import("@/lib/server/dal/apps");
  const response = buildAppResponse(getApp(app.id)!, new Set([3001, 9001, 9003]));
  expect(response.is_running).toBe(true);
  expect(response.conversation_stats).toEqual({ total: 1, open: 1, previews_running: 2 });
  expect(buildAppResponse(getApp(app.id)!, new Set()).is_running).toBe(false);
  expect(checkPortSync).not.toHaveBeenCalled();
});
