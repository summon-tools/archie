import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedConversation, seedUser } from "../../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-tasks-");
  db = await getTestDb(ctx);
});

afterEach(() => ctx.cleanup());

async function loadDal() {
  return await import("@/lib/server/dal/tasks");
}

describe("tasks DAL", () => {
  it("creates tasks in the requested planning state", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const user = seedUser(db, { name: "Planner" });
    const task = dal.createTask({
      app_id: app.id,
      title: "Add a task board",
      description: "Let users plan work before starting an agent.",
      priority: "high",
      created_by: user.id,
    });

    expect(task.title).toBe("Add a task board");
    expect(task.status).toBe("backlog");
    expect(task.priority).toBe("high");
    expect(dal.getTasksByApp(app.id)[0].created_by_name).toBe("Planner");
  });

  it("stores parent tasks and dependencies", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const parent = dal.createTask({ app_id: app.id, title: "Blog feature" });
    const dependency = dal.createTask({ app_id: app.id, title: "Design blog schema" });
    const child = dal.createTask({ app_id: app.id, title: "Build blog editor", parent_task_id: parent.id });

    dal.setTaskDependencies(child.id, [dependency.id]);

    expect(dal.getTask(child.id)?.parent_task_id).toBe(parent.id);
    expect(dal.getTaskDependencies(child.id)).toMatchObject([
      { task_id: child.id, depends_on_task_id: dependency.id, depends_on_title: "Design blog schema" },
    ]);
  });

  it("rejects dependency cycles", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const first = dal.createTask({ app_id: app.id, title: "First" });
    const second = dal.createTask({ app_id: app.id, title: "Second" });
    dal.setTaskDependencies(first.id, [second.id]);

    expect(() => dal.setTaskDependencies(second.id, [first.id])).toThrow("cannot contain a cycle");
  });

  it("links one execution work item to a planning task", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id, { kind: "task" });
    const task = dal.createTask({ app_id: app.id, title: "Implement it" });
    const workItem = db.prepare(
      "INSERT INTO work_items (app_id, primary_conversation_id, title, summary, kind, status, position) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(app.id, conversation.id, "Implement it", "Implementation", "task", "in_progress", 0);

    dal.linkTaskToWorkItem(task.id, Number(workItem.lastInsertRowid));

    expect(dal.getTaskWorkItems(task.id)).toMatchObject([
      { task_id: task.id, work_item_id: Number(workItem.lastInsertRowid), work_item_title: "Implement it" },
    ]);
    expect(dal.getTaskIdsForWorkItem(Number(workItem.lastInsertRowid))).toEqual([task.id]);
  });
});
