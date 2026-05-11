import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedUser } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("rooms-api-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

function makeRequest(
  url: string,
  options?: { body?: object; token?: string },
) {
  const target = new URL(url);
  return {
    json: async () => options?.body || {},
    cookies: {
      get: (name: string) => {
        if (name === "session_token" && options?.token) return { value: options.token };
        return undefined;
      },
    },
    headers: { get: (_name: string) => null },
    nextUrl: target,
    url: target.toString(),
  } as any;
}

async function createAuthToken() {
  const user = seedUser(db, { name: "API Tester", role: "admin" });
  const { createToken } = await import("@/lib/server/auth");
  return createToken(user.id, "API Tester", "admin");
}

describe("rooms API", () => {
  it("requires authentication", async () => {
    const app = seedApp(db);
    const { GET } = await import("@/app/api/apps/[appId]/rooms/route");

    const response = await GET(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms`),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );

    expect(response.status).toBe(401);
  });

  it("creates rooms and lists them for an app", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const routes = await import("@/app/api/apps/[appId]/rooms/route");

    const created = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms`, {
        token,
        body: {
          title: "Planning Room",
          purpose: "Plan Home",
          message: "Let's plan the Home feature.",
        },
      }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );

    expect(created.status).toBe(201);
    const room = await created.json();
    expect(room.title).toBe("Planning Room");

    const listed = await routes.GET(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms`, { token }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );

    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      rooms: [{ id: room.id, title: "Planning Room", purpose: "Plan Home" }],
    });

    const messages = db.prepare("SELECT body_md FROM room_messages WHERE room_id = ?").all(room.id) as { body_md: string }[];
    expect(messages.map((m) => m.body_md)).toEqual(["Let's plan the Home feature."]);
  });

  it("gets and updates a room", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Old Room" });
    const routes = await import("@/app/api/apps/[appId]/rooms/[roomId]/route");

    const updated = await routes.PATCH(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}`, {
        token,
        body: { title: "New Room", purpose: "Updated", status: "archived" },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      id: room.id,
      title: "New Room",
      purpose: "Updated",
      status: "archived",
    });
  });

  it("creates and lists room messages", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Room" });
    const routes = await import("@/app/api/apps/[appId]/rooms/[roomId]/messages/route");

    const created = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/messages`, {
        token,
        body: { content: "Please critique this plan." },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      role: "user",
      body_md: "Please critique this plan.",
    });

    const listed = await routes.GET(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/messages`, { token }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].body_md).toBe("Please critique this plan.");
  });

  it("creates and updates room plans and steps", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Room" });
    const planRoutes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/route");
    const stepRoutes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/steps/route");
    const stepDetailRoutes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/steps/[stepId]/route");

    const planResponse = await planRoutes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan`, {
        token,
        body: { title: "Home plan", summary_md: "Build the Home surface." },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(planResponse.status).toBe(201);
    const planBody = await planResponse.json();
    expect(planBody.plan.title).toBe("Home plan");

    const stepResponse = await stepRoutes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/steps`, {
        token,
        body: {
          title: "Persist rooms",
          objective_md: "Create storage",
          requires_security_review: true,
        },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(stepResponse.status).toBe(201);
    const step = await stepResponse.json();
    expect(step.title).toBe("Persist rooms");
    expect(step.requires_security_review).toBe(1);

    const updatedStep = await stepDetailRoutes.PATCH(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/steps/${step.id}`, {
        token,
        body: { status: "reviewing", result_summary_md: "Storage is ready." },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id), stepId: String(step.id) }) },
    );

    expect(updatedStep.status).toBe(200);
    await expect(updatedStep.json()).resolves.toMatchObject({
      id: step.id,
      status: "reviewing",
      result_summary_md: "Storage is ready.",
    });

    const patchedPlan = await planRoutes.PATCH(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan`, {
        token,
        body: { status: "ready", current_version: 2 },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(patchedPlan.status).toBe(200);
    const patchedBody = await patchedPlan.json();
    expect(patchedBody.plan.status).toBe("ready");
    expect(patchedBody.steps).toHaveLength(1);
  });

  it("launches the next pending plan step as a scoped task conversation", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Execution Room" });
    const plan = dal.createPlan({
      room_id: room.id,
      title: "Plan Mode",
      summary_md: "This summary should not expand every step.",
      status: "ready",
    });
    const firstStep = dal.createPlanStep({
      plan_id: plan.id,
      title: "Create room execution bridge",
      objective_md: "Create only the execution bridge.",
      implementation_prompt_md: "Wire the next pending plan step into a normal task conversation.",
      acceptance_criteria_md: "A work item and conversation are linked back to the step.",
      requires_security_review: true,
    });
    dal.createPlanStep({
      plan_id: plan.id,
      title: "Second step sentinel",
      objective_md: "This later step must not be sent to the first task.",
    });
    const routes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/execute-next/route");

    const response = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/execute-next`, { token }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.plan.status).toBe("executing");
    expect(body.step.id).toBe(firstStep.id);
    expect(body.step.status).toBe("implementing");
    expect(body.step.linked_work_item_id).toBe(body.work_item.id);
    expect(body.step.linked_conversation_id).toBe(body.conversation.id);
    expect(body.work_item.origin_type).toBe("room_plan");

    const message = db.prepare("SELECT body_md FROM messages WHERE conversation_id = ?").get(body.conversation.id) as { body_md: string };
    expect(message.body_md).toContain("Wire the next pending plan step");
    expect(message.body_md).toContain("Security review is required");
    expect(message.body_md).not.toContain("Second step sentinel");

    const event = db.prepare("SELECT * FROM plan_step_events WHERE plan_step_id = ?").get(firstStep.id) as any;
    expect(event.phase).toBe("implementation");
    expect(event.agent_key).toBe("coordinator");

    const roomMessage = db.prepare("SELECT * FROM room_messages WHERE room_id = ? AND kind = 'execution_event'").get(room.id) as any;
    expect(roomMessage.body_md).toContain("Started implementation");
  });

  it("orchestrates review, security, qa, browser, and commit gates deterministically", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Gate Room" });
    const plan = dal.createPlan({ room_id: room.id, title: "Gate Plan", status: "ready" });
    const step = dal.createPlanStep({
      plan_id: plan.id,
      title: "Gate controlled step",
      requires_architecture_review: true,
      requires_security_review: true,
      requires_browser_validation: true,
    });
    const executeRoutes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/execute-next/route");
    const startRoutes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/steps/[stepId]/gates/start/route");
    const advanceRoutes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/steps/[stepId]/gates/advance/route");

    await executeRoutes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/execute-next`, { token }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    const started = await startRoutes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/steps/${step.id}/gates/start`, { token }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id), stepId: String(step.id) }) },
    );
    expect(started.status).toBe(201);
    const startedBody = await started.json();
    expect(startedBody.step.status).toBe("reviewing");
    expect(startedBody.events.filter((event: any) => event.status === "pending").map((event: any) => event.phase)).toEqual([
      "architecture_review",
      "code_review",
      "security_review",
      "qa_validation",
      "browser_validation",
      "commit",
    ]);

    for (const phase of ["architecture_review", "code_review", "security_review", "qa_validation", "browser_validation", "commit"]) {
      const response = await advanceRoutes.POST(
        makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/steps/${step.id}/gates/advance`, {
          token,
          body: {
            status: "passed",
            summary_md: `${phase} passed`,
            commit_sha: phase === "commit" ? "abc123" : undefined,
          },
        }),
        { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id), stepId: String(step.id) }) },
      );
      expect(response.status).toBe(200);
    }

    const completedStep = dal.getPlanStep(step.id)!;
    expect(completedStep.status).toBe("completed");
    expect(completedStep.commit_sha).toBe("abc123");
    expect(dal.getPlan(plan.id)!.status).toBe("completed");
    expect(dal.getPlanStepEvents(step.id).filter((event) => event.status === "completed")).toHaveLength(7);
  });

  it("moves a step back to fixing when a gate fails", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Fix Room" });
    const plan = dal.createPlan({ room_id: room.id, title: "Fix Plan", status: "ready" });
    const step = dal.createPlanStep({
      plan_id: plan.id,
      title: "Security sensitive step",
      status: "implementing",
      requires_security_review: true,
    });
    const startRoutes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/steps/[stepId]/gates/start/route");
    const advanceRoutes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/steps/[stepId]/gates/advance/route");

    await startRoutes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/steps/${step.id}/gates/start`, { token }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id), stepId: String(step.id) }) },
    );
    await advanceRoutes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/steps/${step.id}/gates/advance`, {
        token,
        body: { status: "passed", summary_md: "Review passed" },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id), stepId: String(step.id) }) },
    );
    const failed = await advanceRoutes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/steps/${step.id}/gates/advance`, {
        token,
        body: { status: "failed", summary_md: "Tighten authorization checks." },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id), stepId: String(step.id) }) },
    );

    expect(failed.status).toBe(200);
    const failedBody = await failed.json();
    expect(failedBody.step.status).toBe("fixing");
    expect(dal.getPlanStepEvents(step.id).filter((event) => event.status === "skipped")).toHaveLength(2);
  });
});
