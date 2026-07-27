import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, type TestContext } from "../helpers/test-db";
import { seedUser } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;
let previousDatabasePath: string | undefined;
let previousAuthSecret: string | undefined;
let previousArchieMode: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("model-config-api-");
  previousDatabasePath = process.env.DATABASE_PATH;
  previousAuthSecret = process.env.AUTH_SECRET_KEY;
  previousArchieMode = process.env.ARCHIE_MODE;
  process.env.DATABASE_PATH = ctx.dbPath;
  process.env.AUTH_SECRET_KEY = "test-secret-for-model-config-32chars";
  process.env.ARCHIE_MODE = "development";

  const { getDb } = await import("@/lib/server/db");
  db = getDb();
});

afterEach(() => {
  try {
    db.close();
  } catch {}
  restoreEnv("DATABASE_PATH", previousDatabasePath);
  restoreEnv("AUTH_SECRET_KEY", previousAuthSecret);
  restoreEnv("ARCHIE_MODE", previousArchieMode);
  ctx.cleanup();
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

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

async function createAdminToken() {
  const user = seedUser(db, {
    username: "models-admin",
    email: "models-admin@example.com",
    name: "Models Admin",
    role: "admin",
  });
  const { createToken } = await import("@/lib/server/auth");
  return createToken(user.id, "Models Admin", "admin");
}

describe("model config API", () => {
  it("returns updated model settings after a cached read", async () => {
    const token = await createAdminToken();
    const route = await import("@/app/api/models/config/route");

    const primingResponse = await route.GET(
      makeRequest("http://test.local/api/models/config", { token }),
    );
    expect(primingResponse.status).toBe(200);
    await expect(primingResponse.json()).resolves.toMatchObject({
      availableModels: [
        { id: "claude-opus-5", label: "Opus 5", provider: "claude" },
        { id: "claude-sonnet-5", label: "Sonnet 5", provider: "claude" },
        { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "codex" },
        { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "codex" },
        { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "codex" },
      ],
    });

    const nextConfig = {
      chatModel: "gpt-5.6-sol",
      chatProvider: "codex",
      backgroundModel: "claude-sonnet-5",
      backgroundProvider: "claude",
      quickModel: "gpt-5.6-luna",
      quickProvider: "codex",
      demoModel: "claude-opus-5",
      demoProvider: "claude",
    };

    const postResponse = await route.POST(
      makeRequest("http://test.local/api/models/config", {
        token,
        body: nextConfig,
      }),
    );

    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toMatchObject(nextConfig);

    const getResponse = await route.GET(
      makeRequest("http://test.local/api/models/config", { token }),
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject(nextConfig);
  });
});
