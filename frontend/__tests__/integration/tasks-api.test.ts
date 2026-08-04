import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedUser } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("tasks-api-");
  db = await getTestDb(ctx);
});

afterEach(() => ctx.cleanup());

function makeRequest(url: string, options?: { body?: object; token?: string }) {
  const target = new URL(url);
  return {
    json: async () => options?.body || {},
    cookies: {
      get: (name: string) => name === "session_token" && options?.token ? { value: options.token } : undefined,
    },
    headers: { get: () => null },
    nextUrl: target,
    url: target.toString(),
  } as any;
}

async function authToken() {
  const user = seedUser(db, { name: "Task Owner", role: "admin" });
  const { createToken } = await import("@/lib/server/auth");
  return createToken(user.id, "Task Owner", "admin");
}

describe("project task API", () => {
  it("creates, lists, and updates planning tasks", async () => {
    const app = seedApp(db);
    const token = await authToken();
    const routes = await import("@/app/api/apps/[appId]/tasks/route");
    const detailRoutes = await import("@/app/api/apps/[appId]/tasks/[taskId]/route");

    const createdResponse = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/tasks`, {
        token,
        body: { title: "Add planning board", description: "Create the board before automation." },
      }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created).toMatchObject({ title: "Add planning board", status: "todo", linked_work_items: [] });
    expect(created).not.toHaveProperty("priority");
    expect(created).not.toHaveProperty("parent_task_id");
    expect(created).not.toHaveProperty("dependencies");

    const updatedResponse = await detailRoutes.PATCH(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/tasks/${created.id}`, {
        token,
        body: { status: "todo", description: "Ready for implementation." },
      }),
      { params: Promise.resolve({ appId: String(app.id), taskId: String(created.id) }) },
    );
    expect(updatedResponse.status).toBe(200);
    await expect(updatedResponse.json()).resolves.toMatchObject({ status: "todo", description: "Ready for implementation." });

    const listedResponse = await routes.GET(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/tasks`, { token }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    await expect(listedResponse.json()).resolves.toMatchObject({ tasks: [{ id: created.id, title: "Add planning board" }] });
  });

  it("links a started work item to its planning task", async () => {
    const app = seedApp(db);
    const token = await authToken();
    const taskRoutes = await import("@/app/api/apps/[appId]/tasks/route");
    const workItemRoutes = await import("@/app/api/apps/[appId]/work-items/route");
    const taskResponse = await taskRoutes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/tasks`, { token, body: { title: "Implement task" } }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    const task = await taskResponse.json();

    const workItemResponse = await workItemRoutes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/work-items`, { token, body: { message: "Implement task", task_id: task.id } }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    expect(workItemResponse.status).toBe(201);
    const workItem = await workItemResponse.json();
    expect(workItem.task_ids).toEqual([task.id]);
    expect(db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id)).toMatchObject({ status: "in_progress" });
  });

  it.each(["backlog", "ready", "review", "blocked"])("rejects the removed %s status", async (status) => {
    const app = seedApp(db);
    const token = await authToken();
    const routes = await import("@/app/api/apps/[appId]/tasks/route");

    const response = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/tasks`, { token, body: { title: "Unsupported status", status } }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );

    expect(response.status).toBe(400);
  });

});
