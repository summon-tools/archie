/**
 * Tests for Codex CLI provider event parser.
 */

import { describe, it, expect } from "vitest";
import {
  parseCodexEvent,
  createParseState,
  extractItemText,
  buildResultFromState,
  canSynthesizeSuccess,
  buildCodexExecArgs,
  formatCodexFailureDetail,
} from "@/lib/server/agent/providers/codex";

describe("parseCodexEvent", () => {
  it("extracts assistant text from structured content arrays", () => {
    const text = extractItemText({
      type: "assistant_message",
      content: [
        { type: "output_text", text: "Applied the requested change." },
        { type: "output_text", text: "Tests still need follow-up." },
      ],
    });
    expect(text).toBe("Applied the requested change.\n\nTests still need follow-up.");
  });

  it("handles thread.started → session_id", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({ type: "thread.started", thread_id: "abc-123" }),
      state
    );
    expect(event).toEqual({ type: "session_id", sessionId: "abc-123" });
    expect(state.threadId).toBe("abc-123");
  });

  it("handles item.completed agent_message → text", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Hello world" } }),
      state
    );
    expect(event).toEqual({ type: "text", text: "Hello world" });
    expect(state.lastText).toBe("Hello world");
  });

  it("ignores item.completed user_message so prompts are not treated as answers", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({ type: "item.completed", item: { id: "item_prompt", type: "user_message", text: "Answer this question..." } }),
      state
    );
    expect(event).toBeNull();
    expect(state.lastText).toBe("");
    expect(state.allText).toEqual([]);
    expect(state.sawToolActivity).toBe(false);
  });

  it("handles item.completed command_execution → command activity", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution", command: "ls -la", aggregated_output: "file1\nfile2" },
      }),
      state
    );
    expect(event).toEqual({
      type: "activity",
      activity: {
        kind: "command",
        key: "ls -la",
        command: "ls -la",
        status: "completed",
        output: "file1\nfile2",
      },
    });
  });

  it("handles item.completed error → error event", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "error", text: "Rate limit exceeded" },
      }),
      state
    );
    expect(event).toEqual({ type: "error", error: "Rate limit exceeded" });
  });

  it("handles item.completed error with message field", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "error", message: "API key invalid" },
      }),
      state
    );
    expect(event).toEqual({ type: "error", error: "API key invalid" });
  });

  it("handles text-bearing item.completed events beyond agent_message", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_2",
          type: "assistant_message",
          content: [{ type: "output_text", text: "Done with the changes." }],
        },
      }),
      state
    );
    expect(event).toEqual({ type: "text", text: "Done with the changes." });
    expect(state.lastText).toBe("Done with the changes.");
  });

  it("tracks file_change items as successful tool activity", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_3",
          type: "file_change",
          changes: [{ path: "/tmp/example.txt", kind: "update" }],
          status: "completed",
        },
      }),
      state
    );
    expect(event).toEqual({
      type: "activity",
      activity: {
        kind: "file_change",
        key: "item_3",
        files: [{ path: "/tmp/example.txt", kind: "update" }],
      },
    });
    expect(state.sawToolActivity).toBe(true);
    expect(canSynthesizeSuccess(state, null)).toBe(true);
  });

  it("handles turn.completed → result with usage", () => {
    const state = createParseState();
    state.lastText = "Hello";
    state.threadId = "thread-1";

    const event = parseCodexEvent(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
      state
    );
    expect(event).toEqual({
      type: "result",
      result: {
        text: "Hello",
        sessionId: "thread-1",
        costUsd: null,
        durationMs: null,
        numTurns: 1,
        usage: { inputTokens: 100, outputTokens: 20 },
        models: [],
      },
    });
  });

  it("handles turn.started → status activity", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({ type: "turn.started" }),
      state
    );
    expect(event).toEqual({
      type: "activity",
      activity: { kind: "status", message: "Codex is working..." },
    });
  });

  it("handles top-level error event", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({ type: "error", message: "Connection refused" }),
      state
    );
    expect(event).toEqual({ type: "error", error: "Connection refused" });
  });

  it("maps reconnecting errors to retry activity", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({ type: "error", message: "Reconnecting... 2/5" }),
      state
    );
    expect(event).toEqual({
      type: "activity",
      activity: { kind: "retry", message: "Reconnecting... 2/5" },
    });
  });

  it("returns null for unknown event types", () => {
    const state = createParseState();
    const event = parseCodexEvent(
      JSON.stringify({ type: "some.unknown.event", data: {} }),
      state
    );
    expect(event).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const state = createParseState();
    const event = parseCodexEvent("not json at all", state);
    expect(event).toBeNull();
  });

  it("accumulates state across events", () => {
    const state = createParseState();

    // thread.started
    parseCodexEvent(JSON.stringify({ type: "thread.started", thread_id: "t-1" }), state);
    expect(state.threadId).toBe("t-1");

    // agent_message
    parseCodexEvent(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Done!" } }),
      state
    );
    expect(state.lastText).toBe("Done!");

    // turn.completed — result should have accumulated state
    const result = parseCodexEvent(
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 50, output_tokens: 10 } }),
      state
    );
    expect(result?.type).toBe("result");
    if (result?.type === "result") {
      expect(result.result.text).toBe("Done!");
      expect(result.result.sessionId).toBe("t-1");
    }
  });

  it("marks tool-only clean exits as synthesizable success", () => {
    const state = createParseState();
    state.threadId = "thread-tools-only";
    state.sawToolActivity = true;

    expect(canSynthesizeSuccess(state, null)).toBe(true);
    expect(canSynthesizeSuccess(state, "process failed")).toBe(false);

    expect(buildResultFromState(state, { synthesized: true })).toEqual({
      text: "",
      sessionId: "thread-tools-only",
      costUsd: null,
      durationMs: null,
      numTurns: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
      models: [],
    });
  });
});

describe("buildCodexExecArgs", () => {
  it("uses explicit no-sandbox execution for full-access implementation runs by default", () => {
    const previous = process.env.CODEX_FULL_ACCESS_MODE;
    delete process.env.CODEX_FULL_ACCESS_MODE;

    try {
      const args = buildCodexExecArgs("gpt-5.6-sol", undefined, "full_access");

      expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(args).not.toContain("--full-auto");
      expect(args).not.toContain("--sandbox");
      expect(args).toContain("--model");
      expect(args).toContain("gpt-5.6-sol");
    } finally {
      if (previous === undefined) delete process.env.CODEX_FULL_ACCESS_MODE;
      else process.env.CODEX_FULL_ACCESS_MODE = previous;
    }
  });

  it("maps the shared effort levels to Codex reasoning effort values", () => {
    expect(buildCodexExecArgs("gpt-5.6-sol", undefined, "full_access", "low")).toContain("model_reasoning_effort=low");
    expect(buildCodexExecArgs("gpt-5.6-sol", undefined, "full_access", "medium")).toContain("model_reasoning_effort=medium");
    expect(buildCodexExecArgs("gpt-5.6-sol", undefined, "full_access", "high")).toContain("model_reasoning_effort=high");
    expect(buildCodexExecArgs("gpt-5.6-sol", undefined, "full_access", "max")).toContain("model_reasoning_effort=xhigh");
  });

  it("keeps read-only Codex calls sandboxed by default", () => {
    const previous = process.env.CODEX_READ_ONLY_MODE;
    delete process.env.CODEX_READ_ONLY_MODE;

    try {
      const args = buildCodexExecArgs("gpt-5.6-sol", undefined, "read_only_codebase");
      const sandboxIndex = args.indexOf("--sandbox");

      expect(sandboxIndex).toBeGreaterThanOrEqual(0);
      expect(args[sandboxIndex + 1]).toBe("read-only");
      expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    } finally {
      if (previous === undefined) delete process.env.CODEX_READ_ONLY_MODE;
      else process.env.CODEX_READ_ONLY_MODE = previous;
    }
  });

  it("can bypass the read-only sandbox on hosts where Bubblewrap is unavailable", () => {
    const previous = process.env.CODEX_READ_ONLY_MODE;
    process.env.CODEX_READ_ONLY_MODE = "bypass";

    try {
      const args = buildCodexExecArgs("gpt-5.6-sol", undefined, "read_only_codebase");

      expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(args).not.toContain("--sandbox");
    } finally {
      if (previous === undefined) delete process.env.CODEX_READ_ONLY_MODE;
      else process.env.CODEX_READ_ONLY_MODE = previous;
    }
  });
});

describe("formatCodexFailureDetail", () => {
  it("includes captured stderr, stdout, command, and cwd instead of only the exit code", () => {
    const detail = formatCodexFailureDetail({
      exitError: "Codex CLI exited with code 1",
      stderr: "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted",
      stdout: "{\"type\":\"error\",\"message\":\"sandbox failed\"}",
      args: ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--model", "gpt-5.6-sol", "-"],
      cwd: "/srv/archie/apps/example-task-1",
    });

    expect(detail).toContain("Codex CLI exited with code 1");
    expect(detail).toContain("stderr:");
    expect(detail).toContain("Failed RTM_NEWADDR");
    expect(detail).toContain("stdout:");
    expect(detail).toContain("sandbox failed");
    expect(detail).toContain("command:");
    expect(detail).toContain("codex exec --json --dangerously-bypass-approvals-and-sandbox --model gpt-5.6-sol -");
    expect(detail).toContain("cwd:");
    expect(detail).toContain("/srv/archie/apps/example-task-1");
  });
});
