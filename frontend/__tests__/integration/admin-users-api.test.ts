import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedUser } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("admin-users-api-");
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

async function seedPasswordUser(
  overrides: Partial<{ username: string; name: string; role: string; email: string }> = {},
  password = "old-password",
) {
  const { hashPassword } = await import("@/lib/server/auth");
  return seedUser(db, {
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `user-${Math.random().toString(36).slice(2)}@example.com`,
    password_hash: hashPassword(password),
    ...overrides,
  });
}

describe("admin users API", () => {
  it("lets an admin reset another active user's password", async () => {
    const admin = await seedPasswordUser({
      username: "admin",
      email: "admin@example.com",
      name: "Admin User",
      role: "admin",
    }, "admin-password");
    const target = await seedPasswordUser({
      username: "member",
      email: "member@example.com",
      name: "Member User",
      role: "member",
    }, "old-password");
    const { createToken, verifyPassword } = await import("@/lib/server/auth");
    const token = await createToken(admin.id, "Admin User", "admin");
    const route = await import("@/app/api/admin/users/[id]/password/route");

    const response = await route.POST(
      makeRequest(`http://test.local/api/admin/users/${target.id}/password`, {
        token,
        body: { new_password: "new-password" },
      }),
      { params: Promise.resolve({ id: String(target.id) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ message: "Password reset" });

    const row = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(target.id) as { password_hash: string };
    expect(verifyPassword("new-password", row.password_hash)).toBe(true);
    expect(verifyPassword("old-password", row.password_hash)).toBe(false);
  });

  it("rejects non-admin password reset attempts", async () => {
    const actor = await seedPasswordUser({
      username: "member-actor",
      email: "actor@example.com",
      role: "member",
    }, "actor-password");
    const target = await seedPasswordUser({
      username: "target",
      email: "target@example.com",
      role: "member",
    }, "old-password");
    const { createToken, verifyPassword } = await import("@/lib/server/auth");
    const token = await createToken(actor.id, "Member Actor", "member");
    const route = await import("@/app/api/admin/users/[id]/password/route");

    const response = await route.POST(
      makeRequest(`http://test.local/api/admin/users/${target.id}/password`, {
        token,
        body: { new_password: "new-password" },
      }),
      { params: Promise.resolve({ id: String(target.id) }) },
    );

    expect(response.status).toBe(403);
    const row = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(target.id) as { password_hash: string };
    expect(verifyPassword("old-password", row.password_hash)).toBe(true);
  });

  it("validates the new password before changing the stored hash", async () => {
    const admin = await seedPasswordUser({
      username: "admin",
      email: "admin@example.com",
      role: "admin",
    }, "admin-password");
    const target = await seedPasswordUser({
      username: "target",
      email: "target@example.com",
      role: "member",
    }, "old-password");
    const { createToken, verifyPassword } = await import("@/lib/server/auth");
    const token = await createToken(admin.id, "Admin User", "admin");
    const route = await import("@/app/api/admin/users/[id]/password/route");

    const response = await route.POST(
      makeRequest(`http://test.local/api/admin/users/${target.id}/password`, {
        token,
        body: { new_password: "short" },
      }),
      { params: Promise.resolve({ id: String(target.id) }) },
    );

    expect(response.status).toBe(400);
    const row = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(target.id) as { password_hash: string };
    expect(verifyPassword("old-password", row.password_hash)).toBe(true);
  });

  it("does not reset removed users or the current admin's own password", async () => {
    const admin = await seedPasswordUser({
      username: "admin",
      email: "admin@example.com",
      role: "admin",
    }, "admin-password");
    const removed = await seedPasswordUser({
      username: "removed",
      email: "removed@example.com",
      role: "member",
    }, "old-password");
    db.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ?").run(removed.id);
    const { createToken } = await import("@/lib/server/auth");
    const token = await createToken(admin.id, "Admin User", "admin");
    const route = await import("@/app/api/admin/users/[id]/password/route");

    const removedResponse = await route.POST(
      makeRequest(`http://test.local/api/admin/users/${removed.id}/password`, {
        token,
        body: { new_password: "new-password" },
      }),
      { params: Promise.resolve({ id: String(removed.id) }) },
    );
    expect(removedResponse.status).toBe(400);
    await expect(removedResponse.json()).resolves.toMatchObject({
      detail: "Cannot reset password for a removed user",
    });

    const selfResponse = await route.POST(
      makeRequest(`http://test.local/api/admin/users/${admin.id}/password`, {
        token,
        body: { new_password: "new-password" },
      }),
      { params: Promise.resolve({ id: String(admin.id) }) },
    );
    expect(selfResponse.status).toBe(400);
    await expect(selfResponse.json()).resolves.toMatchObject({
      detail: "Use your profile page to change your own password",
    });
  });
});
