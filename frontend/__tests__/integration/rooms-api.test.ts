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
  vi.doUnmock("@/lib/server/room-agents");
  vi.doUnmock("@/lib/server/agent");
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
    vi.doMock("@/lib/server/room-agents", () => ({
      createRoomAgentReply: vi.fn(async ({ room }: any) => {
        const roomsDal = await import("@/lib/server/dal/rooms");
        return roomsDal.createRoomMessage({
          room_id: room.id,
          role: "agent",
          agent_key: "coordinator",
          body_md: "Mock coordinator reply.",
        });
      }),
    }));
    const routes = await import("@/app/api/apps/[appId]/rooms/[roomId]/messages/route");

    const created = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/messages`, {
        token,
        body: { content: "Please critique this plan.", target_agent_key: "architect" },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      role: "user",
      body_md: "Please critique this plan.",
      payload_json: JSON.stringify({ target_agent_key: "architect" }),
    });

    const listed = await routes.GET(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/messages`, { token }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
    expect(body.messages[0].body_md).toBe("Please critique this plan.");
    expect(body.messages[0].payload_json).toBe(JSON.stringify({ target_agent_key: "architect" }));
    await vi.waitFor(() => {
      const messages = db.prepare("SELECT * FROM room_messages WHERE room_id = ? ORDER BY id ASC").all(room.id) as any[];
      expect(messages[1]).toMatchObject({
        role: "agent",
        agent_key: "coordinator",
        body_md: "Mock coordinator reply.",
      });
    });
  });

  it("returns the user message before the coordinator reply completes", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Room" });
    let resolveReply = () => {};
    const createRoomAgentReply = vi.fn(() => new Promise<void>((resolve) => {
      resolveReply = resolve;
    }));
    vi.doMock("@/lib/server/room-agents", () => ({ createRoomAgentReply }));
    const routes = await import("@/app/api/apps/[appId]/rooms/[roomId]/messages/route");

    const created = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/messages`, {
        token,
        body: { content: "Please respond asynchronously." },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      role: "user",
      body_md: "Please respond asynchronously.",
    });
    expect(createRoomAgentReply).toHaveBeenCalledOnce();
    const messages = db.prepare("SELECT * FROM room_messages WHERE room_id = ?").all(room.id) as any[];
    expect(messages).toHaveLength(1);
    resolveReply();
  });

  it("persists a coordinator response after a room message", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Room" });
    vi.doMock("@/lib/server/room-agents", () => ({
      createRoomAgentReply: vi.fn(async ({ room }: any) => {
        const roomsDal = await import("@/lib/server/dal/rooms");
        return roomsDal.createRoomMessage({
          room_id: room.id,
          role: "agent",
          agent_key: "coordinator",
          body_md: "Mock coordinator reply.",
        });
      }),
    }));
    const routes = await import("@/app/api/apps/[appId]/rooms/[roomId]/messages/route");

    await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/messages`, {
        token,
        body: { content: "Please critique this plan." },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    await vi.waitFor(() => {
      const messages = db.prepare("SELECT * FROM room_messages WHERE room_id = ? ORDER BY id ASC").all(room.id) as any[];
      expect(messages[1]).toMatchObject({
        role: "agent",
        agent_key: "coordinator",
        body_md: "Mock coordinator reply.",
      });
    });

    const listed = await routes.GET(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/messages`, { token }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.messages[1]).toMatchObject({
      role: "agent",
      agent_key: "coordinator",
      body_md: "Mock coordinator reply.",
    });
  });

  it("persists a coordinator agent reply for room chat", async () => {
    const app = seedApp(db);
    const appRow = db.prepare("SELECT * FROM apps WHERE id = ?").get(app.id) as any;
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Room" });
    const userMessage = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      body_md: "Who am I talking to?",
    });
    const toolEnabledStream = vi.fn(async function* () {
      yield { type: "tool_use", tool: "Grep", detail: "/agent/" };
      yield {
        type: "result",
        detail: "Completed",
        resultText: "You are talking to the Coordinator for this planning room.",
      };
    });
    vi.doMock("@/lib/server/agent", () => ({
      getProvider: vi.fn(() => ({ toolEnabledStream })),
    }));
    const { createRoomAgentReply } = await import("@/lib/server/room-agents");

    const reply = await createRoomAgentReply({
      app: appRow,
      room,
      userMessage,
    });

    expect(reply).toMatchObject({
      role: "agent",
      agent_key: "coordinator",
      body_md: "You are talking to the Coordinator for this planning room.",
    });
    expect(toolEnabledStream).toHaveBeenCalledWith(
      expect.stringContaining("Latest user message:\nWho am I talking to?"),
      expect.objectContaining({ model: "claude-sonnet-4-6", cwd: "/tmp/test-app", maxTurns: 6 }),
    );
    expect(toolEnabledStream).toHaveBeenCalledWith(
      expect.stringContaining("Respond as Coordinator."),
      expect.any(Object),
    );

    const run = db.prepare("SELECT * FROM room_agent_runs WHERE room_id = ?").get(room.id) as any;
    expect(run).toMatchObject({
      agent_key: "coordinator",
      status: "completed",
      model_id: "claude-sonnet-4-6",
      tool_policy_json: JSON.stringify({ mode: "planning_chat", tools: "read_only_codebase" }),
    });
    expect(JSON.parse(run.result_json).events[0]).toMatchObject({ type: "tool_use", tool: "Grep" });
  });

  it("routes tagged room messages to the selected agent", async () => {
    const app = seedApp(db);
    const appRow = db.prepare("SELECT * FROM apps WHERE id = ?").get(app.id) as any;
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Room" });
    const userMessage = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      body_md: "Review the architecture.",
      payload_json: JSON.stringify({ target_agent_key: "architect" }),
    });
    const toolEnabledStream = vi.fn(async function* () {
      yield {
        type: "result",
        detail: "Completed",
        resultText: "Architect perspective: split the work into bounded steps.",
      };
    });
    vi.doMock("@/lib/server/agent", () => ({
      getProvider: vi.fn(() => ({ toolEnabledStream })),
    }));
    const { createRoomAgentReply } = await import("@/lib/server/room-agents");

    const reply = await createRoomAgentReply({
      app: appRow,
      room,
      userMessage,
    });

    expect(reply).toMatchObject({
      role: "agent",
      agent_key: "architect",
      body_md: "Architect perspective: split the work into bounded steps.",
    });
    expect(toolEnabledStream).toHaveBeenCalledWith(
      expect.stringContaining("You are the Architect agent inside an Archie planning room"),
      expect.objectContaining({ model: "claude-opus-4-7", cwd: "/tmp/test-app", maxTurns: 6 }),
    );
    expect(toolEnabledStream).toHaveBeenCalledWith(
      expect.stringContaining("Respond as Architect."),
      expect.any(Object),
    );

    const run = db.prepare("SELECT * FROM room_agent_runs WHERE room_id = ?").get(room.id) as any;
    expect(run).toMatchObject({
      agent_key: "architect",
      status: "completed",
      model_id: "claude-opus-4-7",
    });
  });

  it("lets tagged agents review the planning context before a structured plan exists", async () => {
    const app = seedApp(db);
    const appRow = db.prepare("SELECT * FROM apps WHERE id = ?").get(app.id) as any;
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Room" });
    dal.updateRoomPlanningContext(room.id, [
      "## Current direction",
      "- Add a blog feature with public listing and post detail pages.",
      "",
      "## Open questions",
      "- Decide whether admin CRUD is in the first step.",
    ].join("\n"));
    const roomWithContext = dal.getRoom(room.id)!;
    const userMessage = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      body_md: "Architect, what do you think about the plan?",
      payload_json: JSON.stringify({ target_agent_key: "architect" }),
    });
    const toolEnabledStream = vi.fn(async function* (prompt: string) {
      if (prompt.includes("Update the room planning context summary")) {
        yield {
          type: "result",
          detail: "Completed",
          resultText: "## Current direction\n- Blog feature plan reviewed by Architect.\n\n## Decisions so far\n- Keep the first step scoped.\n\n## Open questions\n- Admin CRUD scope remains open.\n\n## Risks and validation\n- Check routing and content rendering.",
        };
        return;
      }

      yield {
        type: "result",
        detail: "Completed",
        resultText: "Architect perspective: the discussed blog plan is reasonable, but split public rendering from admin editing.",
      };
    });
    vi.doMock("@/lib/server/agent", () => ({
      getProvider: vi.fn(() => ({ toolEnabledStream })),
    }));
    const { createRoomAgentReply } = await import("@/lib/server/room-agents");

    const reply = await createRoomAgentReply({
      app: appRow,
      room: roomWithContext,
      userMessage,
    });

    expect(reply).toMatchObject({
      role: "agent",
      agent_key: "architect",
      body_md: "Architect perspective: the discussed blog plan is reasonable, but split public rendering from admin editing.",
    });
    expect(toolEnabledStream.mock.calls[0][0]).toContain("Planning context summary:\n## Current direction");
    expect(toolEnabledStream.mock.calls[0][0]).toContain("Structured plan: none created yet");
    expect(toolEnabledStream.mock.calls[0][0]).toContain("review the working plan from discussion");
    expect(toolEnabledStream).toHaveBeenCalledWith(
      expect.stringContaining("Update the room planning context summary"),
      expect.objectContaining({ model: "claude-opus-4-7", cwd: "/tmp/test-app", maxTurns: 3 }),
    );
    expect(dal.getRoom(room.id)!.planning_context_md).toContain("Blog feature plan reviewed by Architect.");
  });

  it("generates a structured plan when room chat asks for one", async () => {
    const app = seedApp(db);
    const appRow = db.prepare("SELECT * FROM apps WHERE id = ?").get(app.id) as any;
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Planning Room" });
    const userMessage = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      body_md: "Create the implementation plan from this discussion.",
    });
    const generatedPlan = {
      title: "Room execution plan",
      summary_md: "Generated from the room discussion.",
      steps: [
        {
          title: "Persist generated plans",
          objective_md: "Create plan records from agent output.",
          implementation_prompt_md: "Wire chat-driven plan generation into persisted plan records.",
          acceptance_criteria_md: "- Plan is saved\n- Steps are ordered",
          risk_level: "medium",
          requires_architecture_review: true,
          requires_security_review: false,
          requires_browser_validation: false,
        },
        {
          title: "Refresh the plan panel",
          objective_md: "Show generated steps in the room sidebar.",
          implementation_prompt_md: "Refresh the plan SWR cache after the agent creates a plan.",
          acceptance_criteria_md: "- Plan panel shows the generated steps",
          risk_level: "low",
          requires_architecture_review: false,
          requires_security_review: false,
          requires_browser_validation: true,
        },
      ],
    };
    const toolEnabledStream = vi.fn(async function* () {
      yield { type: "tool_use", tool: "Grep", detail: "/RoomWorkspace/" };
      yield {
        type: "result",
        detail: "Completed",
        resultText: JSON.stringify(generatedPlan),
      };
    });
    vi.doMock("@/lib/server/agent", () => ({
      getProvider: vi.fn(() => ({ toolEnabledStream })),
    }));
    const { createRoomAgentReply } = await import("@/lib/server/room-agents");

    const reply = await createRoomAgentReply({ app: appRow, room, userMessage });

    expect(reply).toMatchObject({
      role: "agent",
      agent_key: "coordinator",
      kind: "plan_update",
      body_md: "I created a draft plan with 2 steps. Review it in the Plan panel.",
    });
    expect(toolEnabledStream).toHaveBeenCalledWith(
      expect.stringContaining("Return ONLY valid JSON"),
      expect.objectContaining({ model: "claude-sonnet-4-6", cwd: "/tmp/test-app", maxTurns: 8 }),
    );
    expect(toolEnabledStream).toHaveBeenCalledWith(
      expect.stringContaining("Create the implementation plan from this discussion."),
      expect.any(Object),
    );

    const plans = dal.getPlansByRoom(room.id);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      title: "Room execution plan",
      summary_md: "Generated from the room discussion.",
      status: "draft",
    });
    const steps = dal.getPlanSteps(plans[0].id);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      position: 0,
      title: "Persist generated plans",
      risk_level: "medium",
      requires_architecture_review: 1,
      requires_security_review: 0,
      requires_browser_validation: 0,
    });
    expect(steps[1]).toMatchObject({
      position: 1,
      title: "Refresh the plan panel",
      risk_level: "low",
      requires_browser_validation: 1,
    });

    const run = db.prepare("SELECT * FROM room_agent_runs WHERE room_id = ?").get(room.id) as any;
    expect(run).toMatchObject({
      agent_key: "coordinator",
      status: "completed",
      model_id: "claude-sonnet-4-6",
      tool_policy_json: JSON.stringify({ mode: "plan_generation", tools: "read_only_codebase" }),
    });
    expect(JSON.parse(run.result_json)).toMatchObject({
      plan_id: plans[0].id,
      step_count: 2,
    });
    expect(JSON.parse(reply.payload_json!)).toMatchObject({
      plan_id: plans[0].id,
      step_count: 2,
    });
    expect(dal.getRoom(room.id)!.planning_context_md).toContain("Room execution plan");
  });

  it("repairs unstructured plan generator output before persisting the plan", async () => {
    const app = seedApp(db);
    const appRow = db.prepare("SELECT * FROM apps WHERE id = ?").get(app.id) as any;
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Repair Room" });
    const userMessage = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      body_md: "Generate a draft plan for the blog feature.",
    });
    const toolEnabledStream = vi.fn(async function* () {
      yield {
        type: "result",
        detail: "Completed",
        resultText: "Here is the plan: first add the model, then add routes, then validate it.",
      };
    });
    const ephemeralQuery = vi.fn(async () => JSON.stringify({
      title: "Repaired blog plan",
      summary_md: "Converted from an unstructured model reply.",
      steps: [
        {
          title: "Add blog persistence",
          objective_md: "Create the blog post model and storage.",
          implementation_prompt_md: "Add the Post model and persistence for blog posts.",
          acceptance_criteria_md: "- Blog posts can be persisted",
          risk_level: "medium",
          requires_architecture_review: true,
          requires_security_review: false,
          requires_browser_validation: false,
        },
        {
          title: "Add blog pages",
          objective_md: "Render public blog pages.",
          implementation_prompt_md: "Add blog index and detail routes.",
          acceptance_criteria_md: "- Blog index and detail pages render",
          risk_level: "low",
          requires_architecture_review: false,
          requires_security_review: false,
          requires_browser_validation: true,
        },
      ],
    }));
    vi.doMock("@/lib/server/agent", () => ({
      getProvider: vi.fn(() => ({ toolEnabledStream, ephemeralQuery })),
    }));
    const { createRoomAgentReply } = await import("@/lib/server/room-agents");

    const reply = await createRoomAgentReply({ app: appRow, room, userMessage });

    expect(reply).toMatchObject({
      role: "agent",
      agent_key: "coordinator",
      kind: "plan_update",
      body_md: "I created a draft plan with 2 steps. Review it in the Plan panel.",
    });
    expect(ephemeralQuery).toHaveBeenCalledWith(
      expect.stringContaining("Convert the following plan-generator output into the required JSON object."),
      expect.objectContaining({ model: "claude-sonnet-4-6", cwd: "/tmp/test-app", maxTurns: 1 }),
    );

    const plans = dal.getPlansByRoom(room.id);
    expect(plans[0]).toMatchObject({
      title: "Repaired blog plan",
      summary_md: "Converted from an unstructured model reply.",
    });
    expect(dal.getPlanSteps(plans[0].id).map((step) => step.title)).toEqual([
      "Add blog persistence",
      "Add blog pages",
    ]);

    const run = db.prepare("SELECT * FROM room_agent_runs WHERE room_id = ?").get(room.id) as any;
    expect(JSON.parse(run.result_json)).toMatchObject({
      text: "Here is the plan: first add the model, then add routes, then validate it.",
      repaired_text: expect.stringContaining("Repaired blog plan"),
      plan_id: plans[0].id,
      step_count: 2,
    });
  });

  it("parses fenced plan JSON when step prompts contain markdown code fences", async () => {
    const app = seedApp(db);
    const appRow = db.prepare("SELECT * FROM apps WHERE id = ?").get(app.id) as any;
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({ app_id: app.id, title: "Fence Room" });
    const userMessage = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      body_md: "Create the structured plan for this blog feature.",
    });
    const fencedPlan = {
      title: "Code fence plan",
      summary_md: "Generated JSON includes markdown fences inside a string.",
      steps: [
        {
          title: "Add model code",
          objective_md: "Create model code.",
          implementation_prompt_md: "Use this pattern:\n```ruby\nclass Blog < ApplicationRecord\nend\n```",
          acceptance_criteria_md: "- Model exists",
          risk_level: "medium",
          requires_architecture_review: true,
          requires_security_review: false,
          requires_browser_validation: false,
        },
        {
          title: "Render pages",
          objective_md: "Render public pages.",
          implementation_prompt_md: "Add index and detail views.",
          acceptance_criteria_md: "- Pages render",
          risk_level: "low",
          requires_architecture_review: false,
          requires_security_review: false,
          requires_browser_validation: true,
        },
      ],
    };
    const toolEnabledStream = vi.fn(async function* () {
      yield {
        type: "result",
        detail: "Completed",
        resultText: `\`\`\`json\n${JSON.stringify(fencedPlan, null, 2)}\n\`\`\``,
      };
    });
    const ephemeralQuery = vi.fn();
    vi.doMock("@/lib/server/agent", () => ({
      getProvider: vi.fn(() => ({ toolEnabledStream, ephemeralQuery })),
    }));
    const { createRoomAgentReply } = await import("@/lib/server/room-agents");

    const reply = await createRoomAgentReply({ app: appRow, room, userMessage });

    expect(reply.kind).toBe("plan_update");
    expect(ephemeralQuery).not.toHaveBeenCalled();
    const plans = dal.getPlansByRoom(room.id);
    const steps = dal.getPlanSteps(plans[0].id);
    expect(plans[0].title).toBe("Code fence plan");
    expect(steps[0].implementation_prompt_md).toContain("```ruby");
    expect(steps[1].title).toBe("Render pages");
  });

  it("generates a room plan from the plan API", async () => {
    const app = seedApp(db);
    const token = await createAuthToken();
    const dal = await import("@/lib/server/dal/rooms");
    const room = dal.createRoom({
      app_id: app.id,
      title: "API Planning Room",
      purpose: "Shape the room plan.",
    });
    dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      body_md: "We need a safe step-by-step implementation plan.",
    });
    const toolEnabledStream = vi.fn(async function* () {
      yield {
        type: "result",
        detail: "Completed",
        resultText: JSON.stringify({
          title: "Generated API plan",
          summary_md: "Plan generated through the API.",
          steps: [
            {
              title: "Define the contract",
              objective_md: "Lock the API and persistence contract.",
              implementation_prompt_md: "Implement the generate endpoint contract.",
              acceptance_criteria_md: "- Endpoint returns plan and steps",
              risk_level: "high",
              requires_architecture_review: true,
              requires_security_review: true,
              requires_browser_validation: false,
            },
          ],
        }),
      };
    });
    vi.doMock("@/lib/server/agent", () => ({
      getProvider: vi.fn(() => ({ toolEnabledStream })),
    }));
    const routes = await import("@/app/api/apps/[appId]/rooms/[roomId]/plan/generate/route");

    const response = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/rooms/${room.id}/plan/generate`, { token }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.plan).toMatchObject({
      title: "Generated API plan",
      summary_md: "Plan generated through the API.",
      status: "draft",
    });
    expect(body.planning_context_md).toContain("Generated API plan");
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]).toMatchObject({
      title: "Define the contract",
      risk_level: "high",
      requires_architecture_review: 1,
      requires_security_review: 1,
      requires_browser_validation: 0,
      events: [],
    });
    expect(toolEnabledStream).toHaveBeenCalledWith(
      expect.stringContaining("Recent room messages:"),
      expect.objectContaining({ model: "claude-sonnet-4-6", cwd: "/tmp/test-app", maxTurns: 8 }),
    );
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
