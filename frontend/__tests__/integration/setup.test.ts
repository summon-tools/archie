import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archie-setup-test-"));
  dbPath = path.join(tmpDir, "test.db");
  vi.resetModules();
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

function mockConfig(mode: "development" | "production") {
  vi.doMock("@/lib/server/config", () => ({
    DB_PATH: dbPath,
    MODE: mode,
    AUTH_SECRET_KEY: "test-secret-for-setup-tests-32chars!",
    HOST: "127.0.0.1",
    PORT: 8080,
    FORCE_SECURE_COOKIES: false,
    APP_PORT_START: 3001,
    PREVIEW_PORT_MIN: 9001,
    PREVIEW_PORT_MAX: 9050,
    CLAUDE_DANGEROUS_PERMISSIONS: true,
    getProjectsDir: () => tmpDir,
    getDefaultModel: () => "claude-opus-5",
    getBackgroundModel: () => "claude-opus-5",
  }));
}

function makeRequest(url: string, options?: { body?: object }) {
  const target = new URL(url);
  return {
    json: async () => options?.body || {},
    cookies: { get: (_name: string) => undefined },
    headers: { get: (_name: string) => null },
    nextUrl: target,
    url: target.toString(),
  } as any;
}

describe("production setup bootstrap", () => {
  it("blocks setup completion in production (bootstrap must use install script)", async () => {
    mockConfig("production");
    const { POST } = await import("@/app/api/setup/complete/route");

    const response = await POST(makeRequest("http://localhost:8080/api/setup/complete", {
      body: {
        name: "Archie Admin",
        email: "admin@example.com",
        password: "super-secret",
        projects_dir: tmpDir,
        git_name: "Archie Admin",
        git_email: "admin@example.com",
        generate_ssh_key: false,
      },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      detail: "Initial production setup must be completed from the server install script.",
    });
  });

  it("blocks setup status in production while setup is incomplete", async () => {
    mockConfig("production");
    const { GET } = await import("@/app/api/setup/status/route");

    const response = await GET(makeRequest("http://localhost:8080/api/setup/status"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      detail: "Initial production setup must be completed from the server install script.",
    });
  });
});

describe("development setup flow", () => {
  it("allows setup completion in development without auth", async () => {
    mockConfig("development");
    const { POST } = await import("@/app/api/setup/complete/route");
    const { getDb } = await import("@/lib/server/db");

    const response = await POST(makeRequest("http://localhost:8080/api/setup/complete", {
      body: {
        name: "Dev Admin",
        email: "dev@archie.dev",
        password: "password123",
        projects_dir: tmpDir,
        git_name: "Dev Admin",
        git_email: "dev@archie.dev",
        generate_ssh_key: false,
      },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Setup complete",
      name: "Dev Admin",
    });

    const db = getDb();
    const user = db
      .prepare("SELECT name, email, role FROM users WHERE email = ?")
      .get("dev@archie.dev") as { name: string; email: string; role: string } | undefined;

    expect(user).toMatchObject({
      name: "Dev Admin",
      email: "dev@archie.dev",
      role: "admin",
    });
  });

  it("blocks a second setup attempt once an admin exists", async () => {
    mockConfig("development");
    const { POST } = await import("@/app/api/setup/complete/route");

    const body = {
      name: "Dev Admin",
      email: "dev@archie.dev",
      password: "password123",
      projects_dir: tmpDir,
      git_name: "Dev Admin",
      git_email: "dev@archie.dev",
      generate_ssh_key: false,
    };

    await POST(makeRequest("http://localhost:8080/api/setup/complete", { body }));
    const second = await POST(makeRequest("http://localhost:8080/api/setup/complete", { body }));

    expect(second.status).toBe(403);
    await expect(second.json()).resolves.toMatchObject({ detail: "Setup already completed" });
  });
});
