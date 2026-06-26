import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";

let ctx: TestContext;

beforeEach(() => {
  vi.resetModules();
  ctx = createTestContext("archie-preview-proxy-");
});

afterEach(() => {
  vi.restoreAllMocks();
  ctx.cleanup();
});

describe("preview proxy", () => {
  it("allows unauthenticated access to registered app ports", async () => {
    const db = await getTestDb(ctx);
    db
      .prepare("INSERT INTO apps (name, port, description, directory, github_repo) VALUES (?, ?, ?, ?, ?)")
      .run("Shared App", 4173, "", "", "");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<a href=\"/dashboard\">Dashboard</a>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );

    const { GET } = await import("@/app/api/p/[port]/[[...path]]/route");
    const response = await GET(
      new NextRequest("http://archie.test/api/p/4173/"),
      { params: Promise.resolve({ port: "4173", path: [] }) }
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4173/",
      expect.objectContaining({ method: "GET" })
    );
    await expect(response.text()).resolves.toContain("href=\"/api/p/4173/dashboard\"");
  });

  it("rejects unregistered localhost ports before proxying", async () => {
    await getTestDb(ctx);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const { GET } = await import("@/app/api/p/[port]/[[...path]]/route");
    const response = await GET(
      new NextRequest("http://archie.test/api/p/4567/"),
      { params: Promise.resolve({ port: "4567", path: [] }) }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.detail).toBe("Preview not found");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
