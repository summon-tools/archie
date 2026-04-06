/**
 * Conversation streaming integration test.
 *
 * Verifies the core streaming flow in conversation.ts by mocking:
 * - The agent provider (returns mock events via streamTask/resumeSession)
 * - Knowledge/preflight/context modules (no-op)
 * - DAL operations backed by a real SQLite database
 *
 * NOTE: These tests require better-sqlite3 native module to be built
 * for the correct architecture. If you see architecture mismatch errors,
 * rebuild with: cd frontend && npm rebuild better-sqlite3
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedConversation } from "../helpers/seed";
import { createMockProvider } from "../helpers/mock-provider";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("conversation-stream-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

describe("conversation streaming", () => {
  it("streamConversationMessage saves user message and returns a ReadableStream", async () => {
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);

    // Build a mock provider using the shared helper (correct AgentProvider interface)
    const mockProvider = createMockProvider({
      streamTask: async function* () {
        yield { type: "text" as const, text: "Hello world" };
        yield {
          type: "result" as const,
          result: {
            text: "Hello world",
            sessionId: "mock-sess-1",
            costUsd: 0.001,
            durationMs: 50,
            numTurns: 1,
            usage: { inputTokens: 10, outputTokens: 5 },
            models: ["mock-model"],
          },
        };
      },
    });

    // Mock the agent registry to return our mock provider
    vi.doMock("@/lib/server/agent", () => ({
      getProvider: () => mockProvider,
    }));
    vi.doMock("@/lib/server/knowledge/indexer", () => ({ refreshIfStale: async () => {} }));
    vi.doMock("@/lib/server/knowledge/brief", () => ({ generateWorkItemBrief: async () => "" }));
    vi.doMock("@/lib/server/knowledge/context", () => ({ assembleContext: async () => ({ formatted: "" }) }));
    vi.doMock("@/lib/server/knowledge/preflight", () => ({ preflightCheck: async () => ({ ok: true }) }));
    vi.doMock("@/lib/server/spec", () => ({ readSpecIndex: () => null, readPrinciples: () => null }));
    vi.doMock("@/lib/server/skills", () => ({ readSkillsIndex: () => null }));
    vi.doMock("@/lib/server/prompts/conversation", () => ({ buildConversationSystemPromptBase: () => "You are a helpful assistant." }));

    // Import the conversation module with mocks in place
    const { streamConversationMessage } = await import("@/lib/server/conversation");

    // Collect emitted events
    const { subscribeConversation } = await import("@/lib/server/conversation-events");
    const events: any[] = [];
    subscribeConversation(conversation.id, (e) => events.push(e));

    // Call with positional args matching the real signature:
    // streamConversationMessage(conversationId, content, appName, directory, model?, userId?, retry?, providerId?)
    const stream = await streamConversationMessage(
      conversation.id,
      "Say hello",
      "Test App",
      ctx.tmpDir,
    );

    // The result should be a ReadableStream
    expect(stream).toBeDefined();
    expect(stream).toBeInstanceOf(ReadableStream);

    // Consume the stream to let the provider events flow
    const reader = stream.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    // Verify: user message was saved
    const { getConversationMessages } = await import("@/lib/server/dal/conversations");
    const messages = getConversationMessages(conversation.id);
    const userMsg = messages.find((m: any) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.body_md).toBe("Say hello");

    // Verify: assistant message was saved
    const assistantMsg = messages.find((m: any) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.body_md).toContain("Hello world");

    // Verify: SSE events were sent
    const sseText = chunks.join("");
    expect(sseText).toContain("event: text");
    expect(sseText).toContain("event: done");

    // Verify: conversation events were emitted
    expect(events.length).toBeGreaterThan(0);
    const statusEvents = events.filter((e: any) => e.type === "status");
    expect(statusEvents.length).toBeGreaterThan(0);
  });
});
