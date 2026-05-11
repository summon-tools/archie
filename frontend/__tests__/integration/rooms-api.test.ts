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
});
