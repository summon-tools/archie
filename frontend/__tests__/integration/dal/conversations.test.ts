import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedUser } from "../../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-conversations-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function loadDal() {
  return await import("@/lib/server/dal/conversations");
}

describe("conversations DAL", () => {
  it("createConversation returns a conversation row", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "Hello" });
    expect(conversation.id).toBeDefined();
    expect(conversation.title).toBe("Hello");
    expect(conversation.kind).toBe("conversation");
    expect(conversation.app_id).toBe(app.id);
  });

  it("getConversation retrieves by id", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "T1" });
    const found = dal.getConversation(conversation.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe("T1");
  });

  it("getConversation returns undefined for missing id", async () => {
    const dal = await loadDal();
    expect(dal.getConversation(999)).toBeUndefined();
  });

  it("getConversationsByApp returns conversations for app", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createConversation({ app_id: app.id, kind: "conversation", title: "T1" });
    dal.createConversation({ app_id: app.id, kind: "task", title: "T2" });
    expect(dal.getConversationsByApp(app.id)).toHaveLength(2);
  });

  it("getConversationsByApp filters by kind", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createConversation({ app_id: app.id, kind: "conversation", title: "T1" });
    dal.createConversation({ app_id: app.id, kind: "task", title: "T2" });
    expect(dal.getConversationsByApp(app.id, "task")).toHaveLength(1);
  });

  it("updateConversation changes fields", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "Old" });
    dal.updateConversation(conversation.id, { title: "New", status: "archived" });
    const updated = dal.getConversation(conversation.id)!;
    expect(updated.title).toBe("New");
    expect(updated.status).toBe("archived");
  });

  it("deleteConversation removes conversation", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "T" });
    dal.deleteConversation(conversation.id);
    expect(dal.getConversation(conversation.id)).toBeUndefined();
  });

  it("deleteConversation cascades to messages", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "T" });
    dal.createMessage({ conversation_id: conversation.id, role: "user", body_md: "Hello" });
    dal.deleteConversation(conversation.id);
    expect(dal.getMessageCount(conversation.id)).toBe(0);
  });

  it("createMessage auto-increments seq", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "T" });
    const m1 = dal.createMessage({ conversation_id: conversation.id, role: "user", body_md: "First" });
    const m2 = dal.createMessage({ conversation_id: conversation.id, role: "assistant", body_md: "Second" });
    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
  });

  it("createMessage updates last_message_at on conversation", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "T" });
    const before = dal.getConversation(conversation.id)!.last_message_at;
    dal.createMessage({ conversation_id: conversation.id, role: "user", body_md: "Hello" });
    const after = dal.getConversation(conversation.id)!.last_message_at;
    expect(after).not.toEqual(before);
  });

  it("getConversationMessages joins author info", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const user = seedUser(db, { name: "Alice", color: "#ff0000" });
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "T" });
    dal.createMessage({ conversation_id: conversation.id, role: "user", body_md: "Hi", author_user_id: user.id });
    const msgs = dal.getConversationMessages(conversation.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].author_name).toBe("Alice");
    expect(msgs[0].author_color).toBe("#ff0000");
  });

  it("getMessageCount returns count", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "T" });
    expect(dal.getMessageCount(conversation.id)).toBe(0);
    dal.createMessage({ conversation_id: conversation.id, role: "user", body_md: "A" });
    dal.createMessage({ conversation_id: conversation.id, role: "assistant", body_md: "B" });
    expect(dal.getMessageCount(conversation.id)).toBe(2);
  });

  it("addSystemMessage creates a system-role message", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    const conversation = dal.createConversation({ app_id: app.id, kind: "conversation", title: "T" });
    const msg = dal.addSystemMessage(conversation.id, "Conversation started");
    expect(msg.role).toBe("system");
    expect(msg.body_md).toBe("Conversation started");
  });

  it("getConversationsForApp returns enriched list", async () => {
    const dal = await loadDal();
    const app = seedApp(db);
    dal.createConversation({ app_id: app.id, kind: "conversation", title: "Conversation A" });
    const results = dal.getConversationsForApp(app.id);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Conversation A");
    expect(results[0].work_item_id).toBeNull();
  });
});
