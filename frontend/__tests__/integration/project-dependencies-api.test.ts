import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedUser } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("project-dependencies-");
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
  const user = seedUser(db, { name: "Dependency Owner", role: "admin" });
  const { createToken } = await import("@/lib/server/auth");
  return createToken(user.id, "Dependency Owner", "admin");
}

describe("project dependency API", () => {
  it("creates, lists, updates, and deletes a project dependency", async () => {
    const app = seedApp(db, { name: "Frontend", description: "Customer web app" });
    const dependencyApp = seedApp(db, { name: "Payments API", description: "Payment service and API contracts" });
    db.prepare("UPDATE apps SET directory = ?, github_repo = ? WHERE id = ?").run(
      "/tmp/payments-api",
      "https://github.com/company/payments-api",
      dependencyApp.id,
    );
    const token = await authToken();
    const routes = await import("@/app/api/apps/[appId]/dependencies/route");
    const detailRoutes = await import("@/app/api/apps/[appId]/dependencies/[dependencyId]/route");

    const createdResponse = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/dependencies`, {
        token,
        body: {
          dependency_app_id: dependencyApp.id,
          role: "Backend API",
          purpose: "Read payment routes, schemas, and docs when implementing payment integrations.",
        },
      }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created).toMatchObject({
      dependency_app_id: dependencyApp.id,
      dependency_name: "Payments API",
      dependency_directory: "/tmp/payments-api",
      dependency_github_repo: "https://github.com/company/payments-api",
      role: "Backend API",
    });

    const listedResponse = await routes.GET(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/dependencies`, { token }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    await expect(listedResponse.json()).resolves.toMatchObject({ dependencies: [{ id: created.id, purpose: created.purpose }] });

    const updatedResponse = await detailRoutes.PATCH(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/dependencies/${created.id}`, {
        token,
        body: { role: "Integration reference", purpose: "Read the API contract before changing checkout requests." },
      }),
      { params: Promise.resolve({ appId: String(app.id), dependencyId: String(created.id) }) },
    );
    await expect(updatedResponse.json()).resolves.toMatchObject({ role: "Integration reference", purpose: "Read the API contract before changing checkout requests." });

    const deletedResponse = await detailRoutes.DELETE(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/dependencies/${created.id}`, { token }),
      { params: Promise.resolve({ appId: String(app.id), dependencyId: String(created.id) }) },
    );
    expect(deletedResponse.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS count FROM app_dependencies WHERE app_id = ?").get(app.id)).toMatchObject({ count: 0 });
  });

  it("requires a purpose and rejects self-dependencies", async () => {
    const app = seedApp(db);
    const token = await authToken();
    const routes = await import("@/app/api/apps/[appId]/dependencies/route");

    const missingPurpose = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/dependencies`, {
        token,
        body: { dependency_app_id: app.id, role: "Self" },
      }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    expect(missingPurpose.status).toBe(400);

    const selfDependency = await routes.POST(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/dependencies`, {
        token,
        body: { dependency_app_id: app.id, role: "Self", purpose: "Should not be allowed." },
      }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    expect(selfDependency.status).toBe(400);
  });

  it("includes project description, repository config, role, and purpose in task context", async () => {
    const app = seedApp(db, { name: "Frontend" });
    const dependencyApp = seedApp(db, { name: "Identity API", description: "Authentication and identity service" });
    db.prepare("UPDATE apps SET directory = ?, github_repo = ? WHERE id = ?").run(
      "/tmp/identity-api",
      "https://github.com/company/identity-api",
      dependencyApp.id,
    );
    const dal = await import("@/lib/server/dal");
    dal.createAppDependency({
      app_id: app.id,
      dependency_app_id: dependencyApp.id,
      role: "Auth contract",
      purpose: "Read authentication endpoints and token behavior when adding sign-in flows.",
    });
    vi.doMock("@/lib/server/knowledge/indexer", () => ({ refreshIfStale: async () => {} }));
    const { assembleContext } = await import("@/lib/server/knowledge/context");

    const context = await assembleContext({
      appId: app.id,
      directory: "/tmp/frontend",
      needs: { project_dependencies: true },
    });
    expect(context.formatted).toContain("PROJECT DEPENDENCIES");
    expect(context.formatted).toContain("Identity API");
    expect(context.formatted).toContain("Authentication and identity service");
    expect(context.formatted).toContain("/tmp/identity-api");
    expect(context.formatted).toContain("Auth contract");
    expect(context.formatted).toContain("Read authentication endpoints and token behavior");
  });
});
