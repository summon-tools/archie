import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { createMockProvider } from "../helpers/mock-provider";
import { seedApp, seedConversation, seedWorkItem } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("archie-mcp-route-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
  vi.restoreAllMocks();
});

function makeRequest(body: object, token?: string, origin?: string, url = "http://test.local/api/mcp") {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (origin) headers.set("origin", origin);
  return {
    json: async () => body,
    headers,
    url,
  } as any;
}

async function createToken(scopes: string[], allowedAppIds: number[] = []) {
  const { createMcpToken } = await import("@/lib/server/mcp/auth");
  return createMcpToken({
    name: "Test MCP token",
    scopes,
    allowedAppIds,
  }).secret;
}

describe("remote MCP route", () => {
  it("rejects unauthenticated requests", async () => {
    const route = await import("@/app/api/mcp/route");
    const response = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    }));

    expect(response.status).toBe(401);
  });

  it("initializes and lists tools with a valid token", async () => {
    const token = await createToken(["apps:read"]);
    const route = await import("@/app/api/mcp/route");

    const initResponse = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    }, token));
    expect(initResponse.status).toBe(200);
    const initBody = await initResponse.json();
    expect(initBody.result.serverInfo.name).toBe("archie");
    expect(initBody.result.capabilities.tools).toEqual({ listChanged: false });

    const toolsResponse = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }, token));
    expect(toolsResponse.status).toBe(200);
    const toolsBody = await toolsResponse.json();
    expect(toolsBody.result.tools.some((tool: any) => tool.name === "archie_list_apps")).toBe(true);
    expect(toolsBody.result.tools.some((tool: any) => tool.name === "archie_start_task")).toBe(true);
  });

  it("calls list apps only for token-visible apps and writes audit events", async () => {
    const first = seedApp(db, { name: "Visible App", directory: "/tmp/visible" });
    seedApp(db, { name: "Hidden App", directory: "/tmp/hidden" });
    const token = await createToken(["apps:read"], [first.id]);
    const route = await import("@/app/api/mcp/route");

    const response = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "archie_list_apps",
        arguments: {},
      },
    }, token));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.apps).toHaveLength(1);
    expect(body.result.structuredContent.apps[0]).toMatchObject({
      app_id: first.id,
      name: "Visible App",
    });
    expect(body.result.structuredContent.apps[0].directory).toBeUndefined();

    const audits = db.prepare("SELECT * FROM mcp_audit_events").all() as any[];
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tool_name: "archie_list_apps",
      status: "success",
    });
  });

  it("uses the configured public server URL for app and preview URLs", async () => {
    const app = seedApp(db, { name: "Public URL App", directory: ctx.tmpDir, port: 4321 });
    const conversation = seedConversation(db, app.id, { kind: "task", title: "Preview task" });
    const workItem = seedWorkItem(db, app.id, conversation.id);
    vi.doMock("@/lib/server/apps", () => ({
      checkPortSync: vi.fn(() => false),
      startApp: vi.fn(() => ({ success: true, message: "App started" })),
      stopApp: vi.fn(() => ({ success: true, message: "App stopped" })),
    }));
    vi.doMock("@/lib/server/worktrees", () => ({
      allocatePort: vi.fn(() => 9012),
      getPreviewStatus: vi.fn(() => ({ running: true, port: 9012, url: "/api/p/9012" })),
      startPreview: vi.fn(async () => ({ success: true, message: "Preview started", pid: 12345, healthy: true, statusCode: 200 })),
      stopPreview: vi.fn(() => ({ success: true, message: "Preview stopped" })),
    }));
    const token = await createToken(["servers:start"], [app.id]);
    const { setSetting } = await import("@/lib/server/dal");
    setSetting("public_server_url", "https://archie.example.com/");
    const route = await import("@/app/api/mcp/route");

    const serverResponse = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "archie_start_server",
        arguments: { app_id: app.id },
      },
    }, token, undefined, "http://localhost:3001/api/mcp"));
    const serverBody = await serverResponse.json();
    expect(serverBody.result.structuredContent.url).toBe("https://archie.example.com/api/p/4321");

    const previewResponse = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "archie_start_preview",
        arguments: { app_id: app.id, task_id: workItem.id },
      },
    }, token, undefined, "http://localhost:3001/api/mcp"));
    const previewBody = await previewResponse.json();
    expect(previewBody.result.structuredContent.url).toBe("https://archie.example.com/api/p/9012");
  });

  it("returns a JSON-RPC error when token scopes are insufficient", async () => {
    const token = await createToken(["skills:read"]);
    const route = await import("@/app/api/mcp/route");

    const response = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "archie_list_apps",
        arguments: {},
      },
    }, token));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.error.code).toBe(-32003);
    expect(body.error.message).toContain("apps:read");
  });

  it("uses the configured background model for project questions when omitted", async () => {
    ctx.cleanup();
    vi.resetModules();
    ctx = createTestContext("archie-mcp-route-codex-");
    db = await getTestDb(ctx, {
      getModelForCategory: (category: string) => (
        category === "background"
          ? { provider: "codex", model: "gpt-5.5" }
          : { provider: "claude", model: "claude-opus-4-8" }
      ),
    });

    const app = seedApp(db, { name: "Codex App", directory: ctx.tmpDir });
    const token = await createToken(["apps:read", "project:read"], [app.id]);
    const ephemeralQuery = vi.fn(async () => "Codex answer");
    const getProvider = vi.fn(() => createMockProvider({
      id: "codex",
      ephemeralQuery,
    }));
    vi.doMock("@/lib/server/agent", () => ({ getProvider }));
    const route = await import("@/app/api/mcp/route");

    const response = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "archie_ask_project",
        arguments: {
          app_id: app.id,
          question: "Do we have a blog feature implemented?",
        },
      },
    }, token));

    expect(response.status).toBe(200);
    expect(getProvider).toHaveBeenCalledWith("codex");
    expect(ephemeralQuery).toHaveBeenCalledWith(
      expect.stringContaining("Do we have a blog feature implemented?"),
      expect.objectContaining({
        cwd: ctx.tmpDir,
        model: "gpt-5.5",
        toolPolicy: "read_only_codebase",
      }),
    );
    const body = await response.json();
    expect(body.result.structuredContent).toMatchObject({
      app_id: app.id,
      answer: "Codex answer",
      provider: "codex",
      model: "gpt-5.5",
    });
  });

  it("returns a tool error when a project question provider echoes the generated prompt", async () => {
    const app = seedApp(db, { name: "Prompt Echo App", directory: ctx.tmpDir });
    const token = await createToken(["apps:read", "project:read"], [app.id]);
    const ephemeralQuery = vi.fn(async (prompt: string) => prompt);
    vi.doMock("@/lib/server/agent", () => ({
      getProvider: vi.fn(() => createMockProvider({
        id: "codex",
        ephemeralQuery,
      })),
    }));
    const route = await import("@/app/api/mcp/route");

    const response = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "archie_ask_project",
        arguments: {
          app_id: app.id,
          question: "Which files define authentication?",
        },
      },
    }, token));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("generated provider prompt instead of an answer");

    const audits = db.prepare("SELECT status, error_text FROM mcp_audit_events WHERE tool_name = ?").all("archie_ask_project") as any[];
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      status: "error",
      error_text: expect.stringContaining("generated provider prompt"),
    });
  });

  it("rejects cross-origin browser requests", async () => {
    const token = await createToken(["apps:read"]);
    const route = await import("@/app/api/mcp/route");

    const response = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/list",
    }, token, "http://evil.test"));

    expect(response.status).toBe(403);
  });

  it("allows Postman Web origin for localhost preflight and requests", async () => {
    const token = await createToken(["apps:read"]);
    const route = await import("@/app/api/mcp/route");
    const url = "http://localhost:3001/api/mcp";
    const origin = "https://web.postman.co";

    const preflight = await route.OPTIONS(makeRequest({}, undefined, origin, url));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("POST");

    const response = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "initialize",
    }, token, origin, url));

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    const body = await response.json();
    expect(body.result.serverInfo.name).toBe("archie");
  });

  it("rejects continue_task for non-task conversations", async () => {
    const app = seedApp(db, { name: "Chat App", directory: ctx.tmpDir });
    const conversation = db
      .prepare("INSERT INTO conversations (app_id, kind, title) VALUES (?, 'conversation', ?)")
      .run(app.id, "General chat");
    const token = await createToken(["tasks:write"], [app.id]);
    const route = await import("@/app/api/mcp/route");

    const response = await route.POST(makeRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "archie_continue_task",
        arguments: {
          conversation_id: Number(conversation.lastInsertRowid),
          prompt: "Please change the app",
        },
      },
    }, token));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("task conversations");
  });

  it("serves an authenticated SSE probe stream for HTTP MCP clients", async () => {
    const token = await createToken(["apps:read"]);
    const route = await import("@/app/api/mcp/route");

    const response = await route.GET(makeRequest({}, token));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const chunk = await reader!.read();
    await reader!.cancel();
    expect(new TextDecoder().decode(chunk.value)).toContain("event: endpoint");
  });
});
