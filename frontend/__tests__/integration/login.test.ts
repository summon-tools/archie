import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archie-login-test-"));
  dbPath = path.join(tmpDir, "test.db");
  vi.resetModules();
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

async function setupDbWithUser() {
  vi.doMock("@/lib/server/config", () => ({
    DB_PATH: dbPath,
    MODE: "development",
    AUTH_SECRET_KEY: "test-secret-for-login-tests-32chars!",
    HOST: "127.0.0.1",
    PORT: 8080,
    FORCE_SECURE_COOKIES: false,
    APP_PORT_START: 3001,
    PREVIEW_PORT_MIN: 9001,
    PREVIEW_PORT_MAX: 9050,
    CLAUDE_DANGEROUS_PERMISSIONS: true,
    getProjectsDir: () => tmpDir,
    getDefaultModel: () => "claude-sonnet-4-6",
    getBackgroundModel: () => "claude-sonnet-4-6",
  }));

  const { getDb } = await import("@/lib/server/db");
  const { hashPassword } = await import("@/lib/server/auth");
  const db = getDb();

  const hash = hashPassword("correct-password");
  const result = db.prepare(
    "INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)"
  ).run("alice", hash, "Alice", "admin", "alice@example.com");
  const aliceId = result.lastInsertRowid as number;

  return { db, aliceId };
}

function makeRequest(body: object, ip = "127.0.0.1"): any {
  const url = new URL("http://localhost:8080/api/auth/login");
  return {
    json: async () => body,
    cookies: {
      get: (_name: string) => undefined,
    },
    headers: {
      get: (name: string) => {
        if (name === "x-forwarded-for") return ip;
        return null;
      },
    },
    nextUrl: url,
    url: url.toString(),
  };
}

describe("Login API logic", () => {
  it("verifyPassword works for a real user flow", async () => {
    await setupDbWithUser();
    const { verifyPassword, hashPassword } = await import("@/lib/server/auth");

    // Simulate what the login route does
    const hash = hashPassword("test123");
    expect(verifyPassword("test123", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("createToken and decodeToken round-trip with user data", async () => {
    const { aliceId } = await setupDbWithUser();
    const { createToken, decodeToken } = await import("@/lib/server/auth");

    const token = await createToken(aliceId, "Alice", "admin");
    const payload = await decodeToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(String(aliceId));
    expect(payload!.name).toBe("Alice");
    expect(payload!.role).toBe("admin");
  });

  it("getAuthUser throws AuthError when no cookie present", async () => {
    await setupDbWithUser();
    const { getAuthUser, AuthError } = await import("@/lib/server/auth");

    const request = makeRequest({});
    await expect(getAuthUser(request)).rejects.toThrow(AuthError);
  });

  it("getAuthUser throws AuthError for invalid token", async () => {
    await setupDbWithUser();
    const { getAuthUser, AuthError } = await import("@/lib/server/auth");

    const request = {
      ...makeRequest({}),
      cookies: {
        get: (name: string) =>
          name === "session_token" ? { value: "bad-token" } : undefined,
      },
    };
    await expect(getAuthUser(request)).rejects.toThrow(AuthError);
  });

  it("getAuthUser returns user data for valid token", async () => {
    const { aliceId } = await setupDbWithUser();
    const { getAuthUser, createToken } = await import("@/lib/server/auth");

    // Also mock the db module that getAuthUser requires internally via require("./db")
    const { getDb } = await import("@/lib/server/db");
    vi.doMock("./db", () => ({ getDb }));

    const token = await createToken(aliceId, "Alice", "admin");
    const request = {
      ...makeRequest({}),
      cookies: {
        get: (name: string) =>
          name === "session_token" ? { value: token } : undefined,
      },
    };

    const user = await getAuthUser(request);
    expect(user.id).toBe(aliceId);
    expect(user.name).toBe("Alice");
    // role and name come from the token at minimum
    expect(user.role).toBe("admin");
  });

  it("getAuthUser should reject deactivated user", async () => {
    const { db, aliceId } = await setupDbWithUser();
    const { getAuthUser, createToken, AuthError } = await import(
      "@/lib/server/auth"
    );

    // Deactivate the user
    db.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ?").run(aliceId);

    const token = await createToken(aliceId, "Alice", "admin");
    const request = {
      ...makeRequest({}),
      cookies: {
        get: (name: string) =>
          name === "session_token" ? { value: token } : undefined,
      },
    };

    // getAuthUser must reject deactivated users rather than falling back to
    // token claims.  The catch block in auth.ts now checks both instanceof
    // and error name to reliably re-throw AuthError.
    await expect(getAuthUser(request)).rejects.toThrow(AuthError);
  });

  it("requireAdmin rejects non-admin users", async () => {
    await setupDbWithUser();
    const { requireAdmin, createToken, ForbiddenError } = await import(
      "@/lib/server/auth"
    );

    // Create a member user
    const { getDb } = await import("@/lib/server/db");
    const db = getDb();
    const { hashPassword } = await import("@/lib/server/auth");
    const bobResult = db.prepare(
      "INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)"
    ).run("bob", hashPassword("pass"), "Bob", "member", "bob@example.com");
    const bobId = bobResult.lastInsertRowid as number;

    const token = await createToken(bobId, "Bob", "member");
    const request = {
      ...makeRequest({}),
      cookies: {
        get: (name: string) =>
          name === "session_token" ? { value: token } : undefined,
      },
    };

    await expect(requireAdmin(request)).rejects.toThrow(ForbiddenError);
  });
});
