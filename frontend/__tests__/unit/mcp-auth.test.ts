import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedUser } from "../helpers/seed";

describe("MCP token auth", () => {
  let ctx: TestContext;

  beforeEach(() => {
    vi.resetModules();
    ctx = createTestContext("archie-mcp-auth-");
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("creates hashed bearer tokens and authenticates principals", async () => {
    const db = await getTestDb(ctx);
    const user = seedUser(db, { name: "Ada Admin", email: "ada@example.com" });
    const app = seedApp(db);
    const {
      authenticateMcpBearerToken,
      createMcpToken,
      hashMcpTokenSecret,
      requireMcpAppScope,
      requireMcpScope,
    } = await import("@/lib/server/mcp/auth");
    const dal = await import("@/lib/server/dal");

    const { token, secret } = createMcpToken({
      name: "Cursor",
      scopes: ["apps:read", "tasks:read", "not-a-scope"],
      allowedAppIds: [app.id],
      createdByUserId: user.id,
    });

    expect(secret).toMatch(/^archie_/);
    expect(token.scopes).toEqual(["apps:read", "tasks:read"]);
    expect(token.allowed_app_ids).toEqual([app.id]);
    expect(token.created_by_user_id).toBe(user.id);
    expect(token.created_by_user_name).toBe("Ada Admin");
    expect(token.created_by_user_email).toBe("ada@example.com");

    const stored = dal.getMcpTokenByHash(hashMcpTokenSecret(secret));
    expect(stored?.token_hash).toBe(hashMcpTokenSecret(secret));
    expect((stored as any).secret).toBeUndefined();

    const principal = authenticateMcpBearerToken(`Bearer ${secret}`);
    expect(principal.tokenId).toBe(token.id);
    expect(principal.createdByUserId).toBe(user.id);
    expect(() => requireMcpScope(principal, "apps:read")).not.toThrow();
    expect(() => requireMcpAppScope(principal, app.id, "tasks:read")).not.toThrow();
    expect(() => requireMcpAppScope(principal, app.id + 1, "tasks:read")).toThrow();
  });

  it("rejects revoked tokens", async () => {
    await getTestDb(ctx);
    const { authenticateMcpBearerToken, createMcpToken } = await import("@/lib/server/mcp/auth");
    const dal = await import("@/lib/server/dal");

    const { token, secret } = createMcpToken({
      name: "Revoked",
      scopes: ["apps:read"],
    });
    expect(authenticateMcpBearerToken(`Bearer ${secret}`).tokenId).toBe(token.id);

    dal.revokeMcpToken(token.id);
    expect(() => authenticateMcpBearerToken(`Bearer ${secret}`)).toThrow();
  });

  it("hard deletes tokens while preserving detached audit history", async () => {
    const db = await getTestDb(ctx);
    const { authenticateMcpBearerToken, createMcpToken, hashMcpTokenSecret } = await import("@/lib/server/mcp/auth");
    const dal = await import("@/lib/server/dal");

    const { token, secret } = createMcpToken({
      name: "Delete me",
      scopes: ["apps:read"],
    });
    dal.createMcpAuditEvent({
      token_id: token.id,
      tool_name: "archie_list_apps",
      status: "success",
    });

    expect(dal.deleteMcpToken(token.id)).toBe(true);
    expect(dal.getMcpTokenById(token.id)).toBeUndefined();
    expect(dal.getMcpTokenByHash(hashMcpTokenSecret(secret))).toBeUndefined();
    expect(() => authenticateMcpBearerToken(`Bearer ${secret}`)).toThrow();

    const audits = db.prepare("SELECT token_id, tool_name FROM mcp_audit_events").all() as any[];
    expect(audits).toEqual([{ token_id: null, tool_name: "archie_list_apps" }]);
  });
});
