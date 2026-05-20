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
import { seedApp, seedConversation, seedUser, seedWorkItem } from "../helpers/seed";
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

  it("starts a new provider session when an explicit provider override changes providers", async () => {
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    db.prepare(
      "INSERT INTO agent_sessions (conversation_id, provider_id, external_session_id, status) VALUES (?, ?, ?, ?)",
    ).run(conversation.id, "claude", "claude-session-1", "completed");

    const streamTask = vi.fn(async function* () {
      yield {
        type: "result" as const,
        result: {
          text: "Implemented with Codex.",
          sessionId: "codex-session-1",
          costUsd: 0.001,
          durationMs: 50,
          numTurns: 1,
          usage: { inputTokens: 10, outputTokens: 5 },
          models: ["gpt-5.5"],
        },
      };
    });
    const resumeSession = vi.fn(async function* () {
      yield {
        type: "result" as const,
        result: {
          text: "Should not resume Claude.",
          sessionId: "claude-session-1",
          costUsd: 0.001,
          durationMs: 50,
          numTurns: 1,
          usage: { inputTokens: 10, outputTokens: 5 },
          models: ["claude-sonnet-4-6"],
        },
      };
    });
    const mockProvider = createMockProvider({ streamTask, resumeSession });
    const getProvider = vi.fn(() => mockProvider);

    vi.doMock("@/lib/server/agent", () => ({ getProvider }));
    vi.doMock("@/lib/server/knowledge/indexer", () => ({ refreshIfStale: async () => {} }));
    vi.doMock("@/lib/server/knowledge/brief", () => ({ generateWorkItemBrief: async () => "" }));
    vi.doMock("@/lib/server/knowledge/context", () => ({ assembleContext: async () => ({ formatted: "" }) }));
    vi.doMock("@/lib/server/knowledge/preflight", () => ({ preflightCheck: async () => ({ ok: true }) }));
    vi.doMock("@/lib/server/spec", () => ({ readSpecIndex: () => null, readPrinciples: () => null }));
    vi.doMock("@/lib/server/skills", () => ({ readSkillsIndex: () => null }));
    vi.doMock("@/lib/server/prompts/conversation", () => ({ buildConversationSystemPromptBase: () => "You are a helpful assistant." }));

    const { streamConversationMessage } = await import("@/lib/server/conversation");
    const stream = await streamConversationMessage(
      conversation.id,
      "Implement with the configured implementer.",
      "Test App",
      ctx.tmpDir,
      "gpt-5.5",
      undefined,
      false,
      "codex",
    );

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(getProvider).toHaveBeenCalledWith("codex");
    expect(resumeSession).not.toHaveBeenCalled();
    expect(streamTask).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.5",
    }));

    const session = db.prepare("SELECT * FROM agent_sessions WHERE conversation_id = ?").get(conversation.id) as any;
    expect(session.provider_id).toBe("codex");
    expect(session.external_session_id).toBe("codex-session-1");

    const run = db.prepare("SELECT * FROM runs WHERE conversation_id = ? ORDER BY id DESC LIMIT 1").get(conversation.id) as any;
    expect(run).toMatchObject({
      provider_id: "codex",
      model_id: "gpt-5.5",
      status: "completed",
    });
  });

  it("persists failed provider diagnostics for the conversation status endpoint", async () => {
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const sandboxError = "Codex CLI error: bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted";

    const mockProvider = createMockProvider({
      streamTask: async function* () {
        yield { type: "error" as const, error: sandboxError };
      },
    });

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

    const { streamConversationMessage, getConversationStatus } = await import("@/lib/server/conversation");
    const stream = await streamConversationMessage(
      conversation.id,
      "Read the attached screenshot.",
      "Test App",
      ctx.tmpDir,
      "gpt-5.5",
      undefined,
      false,
      "codex",
    );

    const reader = stream.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    const sseText = chunks.join("");
    expect(sseText).toContain("event: error");
    expect(sseText).toContain("execution_environment");

    const status = getConversationStatus(conversation.id);
    expect(status.claude_status).toBe("failed");
    expect(status.last_error).toMatchObject({
      category: "execution_environment",
      provider_id: "codex",
      model_id: "gpt-5.5",
      detail: sandboxError,
    });

    const run = db.prepare("SELECT * FROM runs WHERE conversation_id = ? ORDER BY id DESC LIMIT 1").get(conversation.id) as any;
    expect(run.failure_category).toBe("execution_environment");
    expect(run.error_text).toBe(sandboxError);
  });

  it("starts plan step gates when a linked implementation conversation completes", async () => {
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id);
    const workItemsDal = await import("@/lib/server/dal/work-items");
    const roomsDal = await import("@/lib/server/dal/rooms");
    const workItem = workItemsDal.createWorkItem({
      app_id: app.id,
      primary_conversation_id: conversation.id,
      title: "Room plan execution",
      origin_type: "room_plan",
    });
    const room = roomsDal.createRoom({ app_id: app.id, title: "Execution Room" });
    const plan = roomsDal.createPlan({ room_id: room.id, title: "Execution Plan", status: "executing" });
    const step = roomsDal.createPlanStep({
      plan_id: plan.id,
      title: "Implement persistence",
      status: "implementing",
    });
    roomsDal.updatePlanStep(step.id, {
      linked_work_item_id: workItem.id,
      linked_conversation_id: conversation.id,
    });
    roomsDal.createPlanStepEvent({
      plan_step_id: step.id,
      phase: "implementation",
      agent_key: "coordinator",
      status: "started",
      summary_md: "Started implementation conversation.",
    });

    const mockProvider = createMockProvider({
      streamTask: async function* () {
        yield {
          type: "result" as const,
          result: {
            text: "Implementation complete.",
            sessionId: "mock-sess-plan",
            costUsd: 0.001,
            durationMs: 50,
            numTurns: 1,
            usage: { inputTokens: 10, outputTokens: 5 },
            models: ["mock-model"],
          },
        };
      },
    });

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

    const { streamConversationMessage } = await import("@/lib/server/conversation");
    const stream = await streamConversationMessage(
      conversation.id,
      "Finish this step",
      "Test App",
      ctx.tmpDir,
    );

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const updatedStep = roomsDal.getPlanStep(step.id)!;
    expect(updatedStep.status).toBe("reviewing");
    const events = roomsDal.getPlanStepEvents(step.id);
    expect(events.find((event) => event.phase === "implementation")?.status).toBe("completed");
    expect(events.filter((event) => event.status === "pending").map((event) => event.phase)).toEqual([
      "code_review",
      "qa_validation",
      "commit",
    ]);
    const roomMessage = db.prepare("SELECT * FROM room_messages WHERE room_id = ? AND kind = 'execution_event'").get(room.id) as any;
    expect(roomMessage.body_md).toContain("Started review gates");
  });

  it("handles explicit git chat commands through the backend flow without invoking the provider", async () => {
    const app = seedApp(db, { directory: ctx.tmpDir });
    const user = seedUser(db);
    const conversation = seedConversation(db, app.id, { kind: "task" });
    const workItem = seedWorkItem(db, app.id, conversation.id);
    db.prepare(
      "INSERT INTO work_item_env (work_item_id, branch_name, worktree_dir, worktree_status) VALUES (?, ?, ?, ?)",
    ).run(workItem.id, "task/test-branch", ctx.tmpDir, "ready");

    const getProvider = vi.fn(() => {
      throw new Error("provider should not be called");
    });
    const publishWorkItemBranch = vi.fn(async () => ({
      success: true,
      action: "publish_pr",
      message: "Pull request #7 created",
      chat_message: "Pushed branch `task/test-branch` using the connected GitHub account.\nPR #7: https://github.com/acme/repo/pull/7",
      branch: "task/test-branch",
      commit_hash: "abc1234",
      pr_url: "https://github.com/acme/repo/pull/7",
      pr_number: 7,
    }));

    vi.doMock("@/lib/server/agent", () => ({ getProvider }));
    vi.doMock("@/lib/server/git-workflows", () => ({
      publishWorkItemBranch,
      pullWorkItemBranch: vi.fn(),
      pullAppDefaultBranch: vi.fn(),
    }));

    const { streamConversationMessage } = await import("@/lib/server/conversation");
    const stream = await streamConversationMessage(
      conversation.id,
      "commit and push and create a PR",
      "Test App",
      ctx.tmpDir,
      undefined,
      user.id,
    );

    const reader = stream.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    expect(getProvider).not.toHaveBeenCalled();
    expect(publishWorkItemBranch).toHaveBeenCalledWith(expect.objectContaining({
      appId: app.id,
      workItemId: workItem.id,
      mode: "publish_pr",
      user: expect.objectContaining({ id: user.id, name: "Test User" }),
    }));
    expect(chunks.join("")).toContain("event: done");

    const messages = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC").all(conversation.id) as any[];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0].body_md).toBe("commit and push and create a PR");
    expect(messages[1].body_md).toContain("PR #7");
  });

  it("keeps non-git chat on the provider path", async () => {
    const app = seedApp(db, { directory: ctx.tmpDir });
    const conversation = seedConversation(db, app.id);
    const streamTask = vi.fn(async function* () {
      yield {
        type: "result" as const,
        result: {
          text: "Provider handled this.",
          sessionId: "provider-session",
          costUsd: 0.001,
          durationMs: 20,
          numTurns: 1,
          usage: { inputTokens: 5, outputTokens: 5 },
          models: ["mock-model"],
        },
      };
    });
    const mockProvider = createMockProvider({ streamTask });
    vi.doMock("@/lib/server/agent", () => ({ getProvider: () => mockProvider }));
    vi.doMock("@/lib/server/knowledge/indexer", () => ({ refreshIfStale: async () => {} }));
    vi.doMock("@/lib/server/knowledge/brief", () => ({ generateWorkItemBrief: async () => "" }));
    vi.doMock("@/lib/server/knowledge/context", () => ({ assembleContext: async () => ({ formatted: "" }) }));
    vi.doMock("@/lib/server/knowledge/preflight", () => ({ preflightCheck: async () => ({ ok: true }) }));
    vi.doMock("@/lib/server/spec", () => ({ readSpecIndex: () => null, readPrinciples: () => null }));
    vi.doMock("@/lib/server/skills", () => ({ readSkillsIndex: () => null }));
    vi.doMock("@/lib/server/prompts/conversation", () => ({ buildConversationSystemPromptBase: () => "You are a helpful assistant." }));

    const { streamConversationMessage } = await import("@/lib/server/conversation");
    const stream = await streamConversationMessage(conversation.id, "Please inspect the app", "Test App", ctx.tmpDir);
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(streamTask).toHaveBeenCalledTimes(1);
  });

  it("returns dirty pull failures as assistant messages", async () => {
    const app = seedApp(db, { directory: ctx.tmpDir });
    const user = seedUser(db);
    const conversation = seedConversation(db, app.id, { kind: "task" });
    const workItem = seedWorkItem(db, app.id, conversation.id);
    db.prepare(
      "INSERT INTO work_item_env (work_item_id, branch_name, worktree_dir, worktree_status) VALUES (?, ?, ?, ?)",
    ).run(workItem.id, "task/test-branch", ctx.tmpDir, "ready");

    vi.doMock("@/lib/server/agent", () => ({ getProvider: vi.fn() }));
    vi.doMock("@/lib/server/git-workflows", () => ({
      publishWorkItemBranch: vi.fn(),
      pullWorkItemBranch: vi.fn(async () => {
        throw new Error("Cannot pull because the worktree has local changes. Commit, push, or stash them before pulling.");
      }),
      pullAppDefaultBranch: vi.fn(),
    }));

    const { streamConversationMessage } = await import("@/lib/server/conversation");
    const stream = await streamConversationMessage(
      conversation.id,
      "pull latest",
      "Test App",
      ctx.tmpDir,
      undefined,
      user.id,
    );
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const assistant = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND role = 'assistant'").get(conversation.id) as any;
    expect(assistant.body_md).toContain("I couldn't complete that git operation.");
    expect(assistant.body_md).toContain("worktree has local changes");
  });
});
