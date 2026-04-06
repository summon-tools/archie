import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedConversation } from "../../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-sessions-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function loadDal() {
  return await import("@/lib/server/dal/sessions");
}

describe("sessions DAL", () => {
  it("createSession returns session row", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const session = dal.createSession({ conversation_id: conversation.id });
    expect(session.id).toBeDefined();
    expect(session.conversation_id).toBe(conversation.id);
    expect(session.provider_id).toBe("claude");
  });

  it("createSession with custom fields", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const session = dal.createSession({
      conversation_id: conversation.id,
      provider_id: "openai",
      external_session_id: "ext-123",
      last_model_id: "gpt-4",
    });
    expect(session.provider_id).toBe("openai");
    expect(session.external_session_id).toBe("ext-123");
    expect(session.last_model_id).toBe("gpt-4");
  });

  it("getSession retrieves by id", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const session = dal.createSession({ conversation_id: conversation.id });
    const found = dal.getSession(session.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(session.id);
  });

  it("getSession returns undefined for missing", async () => {
    const dal = await loadDal();
    expect(dal.getSession(999)).toBeUndefined();
  });

  it("getSessionForConversation retrieves by conversation_id", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    dal.createSession({ conversation_id: conversation.id });
    const found = dal.getSessionForConversation(conversation.id);
    expect(found).toBeDefined();
    expect(found!.conversation_id).toBe(conversation.id);
  });

  it("getSessionForConversation returns undefined when none", async () => {
    const dal = await loadDal();
    expect(dal.getSessionForConversation(999)).toBeUndefined();
  });

  it("updateSession changes fields", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const session = dal.createSession({ conversation_id: conversation.id });
    dal.updateSession(session.id, { status: "active", last_model_id: "claude-sonnet-4-6" });
    const updated = dal.getSession(session.id)!;
    expect(updated.status).toBe("active");
    expect(updated.last_model_id).toBe("claude-sonnet-4-6");
  });

  it("upsertSessionForConversation creates new session", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const session = dal.upsertSessionForConversation(conversation.id, { provider_id: "claude" });
    expect(session.id).toBeDefined();
    expect(session.conversation_id).toBe(conversation.id);
  });

  it("upsertSessionForConversation updates existing session", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const original = dal.createSession({ conversation_id: conversation.id, last_model_id: "old" });
    const updated = dal.upsertSessionForConversation(conversation.id, { last_model_id: "new" });
    expect(updated.id).toBe(original.id);
    expect(updated.last_model_id).toBe("new");
  });
});
