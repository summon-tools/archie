import { describe, it, expect, beforeEach } from "vitest";
import { emitConversationEvent, subscribeConversation, getEventSeq } from "@/lib/server/conversation-events";

// Reset the global event bus between tests
beforeEach(() => {
  (globalThis as any)._conversationEventBus = undefined;
});

describe("conversation event bus", () => {
  it("emits and receives a message event", () => {
    const received: any[] = [];
    subscribeConversation(1, (e) => received.push(e));

    emitConversationEvent(1, {
      type: "message",
      message: {
        id: 100,
        conversation_id: 1,
        role: "user",
        content: "hello",
        message_type: "text",
        created_by_name: "Alice",
        created_by_color: null,
        created_at: "2026-01-01",
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("message");
    expect(received[0].id).toBe(1); // auto-incrementing id
  });

  it("emits status events", () => {
    const received: any[] = [];
    subscribeConversation(1, (e) => received.push(e));

    emitConversationEvent(1, { type: "status", status: "running" });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("status");
    expect(received[0].status).toBe("running");
  });

  it("auto-increments event IDs", () => {
    const received: any[] = [];
    subscribeConversation(1, (e) => received.push(e));

    emitConversationEvent(1, { type: "status", status: "running" });
    emitConversationEvent(1, { type: "status", status: "done" });

    expect(received[0].id).toBe(1);
    expect(received[1].id).toBe(2);
  });

  it("supports multiple listeners on same conversation", () => {
    const received1: any[] = [];
    const received2: any[] = [];
    subscribeConversation(1, (e) => received1.push(e));
    subscribeConversation(1, (e) => received2.push(e));

    emitConversationEvent(1, { type: "status", status: "running" });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it("unsubscribe removes listener", () => {
    const received: any[] = [];
    const unsub = subscribeConversation(1, (e) => received.push(e));

    emitConversationEvent(1, { type: "status", status: "running" });
    unsub();
    emitConversationEvent(1, { type: "status", status: "done" });

    expect(received).toHaveLength(1);
  });

  it("events are scoped per conversation", () => {
    const received1: any[] = [];
    const received2: any[] = [];
    subscribeConversation(1, (e) => received1.push(e));
    subscribeConversation(2, (e) => received2.push(e));

    emitConversationEvent(1, { type: "status", status: "running" });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(0);
  });

  it("getEventSeq returns current sequence", () => {
    expect(getEventSeq()).toBe(0);
    emitConversationEvent(1, { type: "status", status: "running" });
    expect(getEventSeq()).toBe(1);
    emitConversationEvent(1, { type: "status", status: "done" });
    expect(getEventSeq()).toBe(2);
  });

  it("listener errors do not break other listeners", () => {
    const received: any[] = [];
    subscribeConversation(1, () => { throw new Error("boom"); });
    subscribeConversation(1, (e) => received.push(e));

    emitConversationEvent(1, { type: "status", status: "running" });

    expect(received).toHaveLength(1);
  });

  it("emitting to conversation with no subscribers is a no-op", () => {
    // Should not throw
    emitConversationEvent(999, { type: "status", status: "running" });
    expect(getEventSeq()).toBe(1); // seq still increments
  });
});
