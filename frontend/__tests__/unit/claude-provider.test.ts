import { afterEach, describe, expect, it, vi } from "vitest";

describe("ClaudeProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses read-only codebase tools and a multi-turn budget for read-only ephemeral queries", async () => {
    let capturedOptions: any = null;
    const close = vi.fn();

    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: ({ options }: any) => {
        capturedOptions = options;
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "result",
              subtype: "success",
              result: "Project answer",
              session_id: "claude-session-1",
              usage: { input_tokens: 1, output_tokens: 1 },
              modelUsage: {},
            };
          },
          close,
        };
      },
    }));

    const { ClaudeProvider } = await import("@/lib/server/agent/providers/claude");
    const provider = new ClaudeProvider();
    const result = await provider.ephemeralQuery("Inspect the project", {
      cwd: "/tmp/example-project",
      toolPolicy: "read_only_codebase",
      effort: "max",
    });

    expect(result).toBe("Project answer");
    expect(capturedOptions).toMatchObject({
      cwd: "/tmp/example-project",
      maxTurns: 15,
      permissionMode: "acceptEdits",
      tools: ["Read", "Glob", "Grep", "LS"],
      allowedTools: ["Read", "Glob", "Grep", "LS"],
      disallowedTools: expect.arrayContaining(["Bash", "Write", "Edit", "Task"]),
      effort: "max",
    });
    expect(capturedOptions.allowDangerouslySkipPermissions).toBeUndefined();
    expect(close).toHaveBeenCalled();
  });

  it("authorizes dependency directories for streamed project tasks", async () => {
    let capturedOptions: any = null;
    const close = vi.fn();

    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: ({ options }: any) => {
        capturedOptions = options;
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "result",
              subtype: "success",
              result: "Done",
              session_id: "claude-session-2",
              usage: { input_tokens: 1, output_tokens: 1 },
              modelUsage: {},
            };
          },
          close,
        };
      },
    }));

    const { ClaudeProvider } = await import("@/lib/server/agent/providers/claude");
    const provider = new ClaudeProvider();
    for await (const _event of provider.streamTask({
      prompt: "Inspect the API dependency",
      cwd: "/tmp/frontend",
      additionalDirectories: ["/tmp/identity-api", "/tmp/shared-types"],
    })) {
      // Consume the stream so the SDK query runs to completion.
    }

    expect(capturedOptions).toMatchObject({
      cwd: "/tmp/frontend",
      additionalDirectories: ["/tmp/identity-api", "/tmp/shared-types"],
    });
    expect(close).toHaveBeenCalled();
  });
});
