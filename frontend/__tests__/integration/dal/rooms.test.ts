import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedUser, seedConversation, seedWorkItem } from "../../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-rooms-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function loadDal() {
  return await import("@/lib/server/dal/rooms");
}

describe("rooms DAL", () => {
  it("creates and lists rooms for an app", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const user = seedUser(db);

    const room = dal.createRoom({
      app_id: app.id,
      title: "Planning Room",
      purpose: "Plan a larger feature",
      created_by: user.id,
    });

    expect(room.id).toBeDefined();
    expect(room.title).toBe("Planning Room");
    expect(room.purpose).toBe("Plan a larger feature");
    expect(room.planning_context_md).toBe("");
    expect(room.planning_context_updated_at).toBe(null);
    expect(room.status).toBe("open");
    expect(room.created_by).toBe(user.id);

    const rooms = dal.getRoomsByApp(app.id);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe(room.id);
  });

  it("updates room title, purpose, and status", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const room = dal.createRoom({ app_id: app.id, title: "Old" });

    dal.updateRoom(room.id, {
      title: "New",
      purpose: "Updated purpose",
      status: "archived",
    });

    const updated = dal.getRoom(room.id)!;
    expect(updated.title).toBe("New");
    expect(updated.purpose).toBe("Updated purpose");
    expect(updated.status).toBe("archived");
  });

  it("updates the room planning context summary", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const room = dal.createRoom({ app_id: app.id, title: "Room" });

    dal.updateRoomPlanningContext(room.id, "## Current direction\n- Build the blog feature.");

    const updated = dal.getRoom(room.id)!;
    expect(updated.planning_context_md).toBe("## Current direction\n- Build the blog feature.");
    expect(updated.planning_context_updated_at).toBeTruthy();
  });

  it("creates and retrieves room messages in insertion order", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const user = seedUser(db, { name: "Alice" });
    const room = dal.createRoom({ app_id: app.id, title: "Room" });

    const m1 = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      body_md: "Can we plan this?",
      author_user_id: user.id,
    });
    const m2 = dal.createRoomMessage({
      room_id: room.id,
      role: "agent",
      agent_key: "coordinator",
      kind: "plan_update",
      body_md: "I drafted a plan.",
      payload_json: JSON.stringify({ plan_id: 1 }),
    });

    const messages = dal.getRoomMessages(room.id);
    expect(messages.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(messages[0].author_user_id).toBe(user.id);
    expect(messages[1].agent_key).toBe("coordinator");
    expect(messages[1].kind).toBe("plan_update");
  });

  it("creates and updates room agent runs", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const room = dal.createRoom({ app_id: app.id, title: "Room" });

    const run = dal.createRoomAgentRun({
      room_id: room.id,
      agent_key: "security",
      provider_id: "claude",
      model_id: "claude-opus-4-7",
      phase: "security",
      tool_policy_json: JSON.stringify({ readRepo: true, writeRepo: false }),
      input_json: JSON.stringify({ prompt: "Review the plan" }),
    });

    expect(run.status).toBe("running");
    dal.updateRoomAgentRun(run.id, {
      status: "completed",
      result_json: JSON.stringify({ status: "approved" }),
    });

    const runs = dal.getRoomAgentRuns(room.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].agent_key).toBe("security");
  });

  it("creates plans, steps, and step events", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const room = dal.createRoom({ app_id: app.id, title: "Room" });

    const plan = dal.createPlan({
      room_id: room.id,
      title: "Task plan mode",
      summary_md: "Build Home and Rooms.",
    });

    const step1 = dal.createPlanStep({
      plan_id: plan.id,
      title: "Add persistence",
      objective_md: "Create durable storage.",
      implementation_prompt_md: "Add tables and DAL.",
      acceptance_criteria_md: "- Tables exist\n- Tests pass",
      requires_security_review: true,
    });
    const step2 = dal.createPlanStep({
      plan_id: plan.id,
      title: "Add UI",
      risk_level: "low",
    });

    expect(step1.position).toBe(0);
    expect(step2.position).toBe(1);
    expect(step1.requires_security_review).toBe(1);

    dal.updatePlan(plan.id, { status: "ready", current_version: 2 });
    dal.updatePlanStep(step1.id, {
      status: "reviewing",
      result_summary_md: "Persistence added.",
    });

    const event = dal.createPlanStepEvent({
      plan_step_id: step1.id,
      phase: "reviewing",
      agent_key: "reviewer",
      status: "completed",
      summary_md: "Looks good.",
    });

    expect(event.id).toBeDefined();
    expect(dal.getPlan(plan.id)!.status).toBe("ready");
    expect(dal.getPlansByRoom(room.id)).toHaveLength(1);
    expect(dal.getPlanSteps(plan.id).map((s) => s.title)).toEqual(["Add persistence", "Add UI"]);
    expect(dal.getPlanStep(step1.id)!.status).toBe("reviewing");
    expect(dal.getPlanStepEvents(step1.id)).toHaveLength(1);
  });

  it("links plan steps to existing work item conversations", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const room = dal.createRoom({ app_id: app.id, title: "Room" });
    const plan = dal.createPlan({ room_id: room.id, title: "Plan" });
    const conversation = seedConversation(db, app.id, { kind: "task", title: "Implement step" });
    const workItem = seedWorkItem(db, app.id, conversation.id, { title: "Implement step" });
    const step = dal.createPlanStep({ plan_id: plan.id, title: "Step" });

    dal.updatePlanStep(step.id, {
      linked_conversation_id: conversation.id,
      linked_work_item_id: workItem.id,
      commit_sha: "abc123",
      status: "completed",
    });

    const updated = dal.getPlanStep(step.id)!;
    expect(updated.linked_conversation_id).toBe(conversation.id);
    expect(updated.linked_work_item_id).toBe(workItem.id);
    expect(updated.commit_sha).toBe("abc123");
  });

  it("cascades room deletion to messages, runs, plans, steps, and events", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const room = dal.createRoom({ app_id: app.id, title: "Room" });
    dal.createRoomMessage({ room_id: room.id, role: "user", body_md: "Hello" });
    dal.createRoomAgentRun({
      room_id: room.id,
      agent_key: "coordinator",
      provider_id: "claude",
      phase: "coordination",
    });
    const plan = dal.createPlan({ room_id: room.id, title: "Plan" });
    const step = dal.createPlanStep({ plan_id: plan.id, title: "Step" });
    dal.createPlanStepEvent({ plan_step_id: step.id, phase: "reviewing", status: "completed" });

    db.prepare("DELETE FROM home_rooms WHERE id = ?").run(room.id);

    expect(db.prepare("SELECT * FROM room_messages WHERE room_id = ?").all(room.id)).toHaveLength(0);
    expect(db.prepare("SELECT * FROM room_agent_runs WHERE room_id = ?").all(room.id)).toHaveLength(0);
    expect(db.prepare("SELECT * FROM plans WHERE room_id = ?").all(room.id)).toHaveLength(0);
    expect(db.prepare("SELECT * FROM plan_steps WHERE plan_id = ?").all(plan.id)).toHaveLength(0);
    expect(db.prepare("SELECT * FROM plan_step_events WHERE plan_step_id = ?").all(step.id)).toHaveLength(0);
  });
});
