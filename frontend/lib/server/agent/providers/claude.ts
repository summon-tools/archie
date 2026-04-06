/**
 * Claude Agent SDK provider adapter.
 * Wraps the Claude Code SDK into the AgentProvider interface.
 */

import type { Options, SDKResultSuccess, SDKResultError, Query } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_DANGEROUS_PERMISSIONS } from "../../config";
import type {
  AgentProvider,
  AgentStreamEvent,
  AgentResult,
  StreamTaskParams,
  ResumeSessionParams,
  EphemeralOpts,
  ModelEntry,
  ToolStreamEvent,
} from "../types";

// Ensure subprocess has enough output token budget
if (!process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS) {
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = "65536";
}

const CLAUDE_MODELS: ModelEntry[] = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", provider: "claude" },
  { id: "claude-opus-4-6", label: "Opus 4.6", provider: "claude" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", provider: "claude" },
];

// Cached SDK query function
let _sdkQuery: ((args: { prompt: string; options: Options }) => Query) | null = null;
async function getSdkQuery() {
  if (!_sdkQuery) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    _sdkQuery = sdk.query;
  }
  return _sdkQuery;
}

function getPermissionOptions(): Partial<Options> {
  if (CLAUDE_DANGEROUS_PERMISSIONS) {
    return { permissionMode: "bypassPermissions" as const, allowDangerouslySkipPermissions: true };
  }
  return { permissionMode: "acceptEdits" as const };
}

function buildSdkOptions(cwd?: string, sessionId?: string): Options {
  const opts: Options = {};
  if (cwd) opts.cwd = cwd;
  if (sessionId) opts.resume = sessionId;
  if (CLAUDE_DANGEROUS_PERMISSIONS) {
    opts.permissionMode = "bypassPermissions";
    opts.allowDangerouslySkipPermissions = true;
  } else {
    opts.permissionMode = "acceptEdits";
  }
  opts.settingSources = [];
  return opts;
}

function extractResultInfo(result: SDKResultSuccess | SDKResultError): AgentResult {
  const text = result.subtype === "success" ? (result as SDKResultSuccess).result || "" : "";
  const usage = result.usage;
  const inTokens = usage
    ? (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
    : null;
  const outTokens = usage ? (usage.output_tokens || 0) : null;

  const modelUsage = result.modelUsage || {};
  const models = Object.keys(modelUsage);

  return {
    text,
    sessionId: result.session_id || null,
    costUsd: result.total_cost_usd ?? null,
    durationMs: result.duration_ms ?? null,
    numTurns: result.num_turns ?? null,
    usage: inTokens !== null ? { inputTokens: inTokens!, outputTokens: outTokens! } : null,
    models,
  };
}

export class ClaudeProvider implements AgentProvider {
  readonly id = "claude";
  readonly label = "Claude Code";

  async *streamTask(params: StreamTaskParams): AsyncGenerator<AgentStreamEvent> {
    yield* this._stream(params);
  }

  async *resumeSession(params: ResumeSessionParams): AsyncGenerator<AgentStreamEvent> {
    yield* this._stream(params, params.sessionId);
  }

  private async *_stream(
    params: StreamTaskParams,
    sessionId?: string
  ): AsyncGenerator<AgentStreamEvent> {
    const sdkQuery = await getSdkQuery();
    const opts = buildSdkOptions(params.cwd, sessionId);
    if (params.abortController) opts.abortController = params.abortController;
    opts.includePartialMessages = true;
    if (params.model) opts.model = params.model;

    const q = sdkQuery({ prompt: params.prompt, options: opts });

    const activeTools = new Map<number, { name: string; inputChunks: string[] }>();

    try {
      for await (const msg of q) {
        // Session ID from init
        if (msg.type === "system" && "subtype" in msg && (msg as any).subtype === "init") {
          if ((msg as any).session_id) {
            yield { type: "session_id", sessionId: (msg as any).session_id };
          }
        }

        if (msg.type === "stream_event") {
          if ((msg as any).session_id) {
            yield { type: "session_id", sessionId: (msg as any).session_id };
          }
          const event = (msg as any).event;

          // Text delta
          if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
            yield { type: "text", text: event.delta.text };
          }

          // Tool events
          if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") {
            const index = event.index as number;
            const toolName = event.content_block.name as string;
            activeTools.set(index, { name: toolName, inputChunks: [] });
            yield {
              type: "activity",
              activity: { kind: "tool_start", key: String(index), label: toolName },
            };
          }

          if (event?.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
            const index = event.index as number;
            const entry = activeTools.get(index);
            if (entry) entry.inputChunks.push(event.delta.partial_json || "");
          }

          if (event?.type === "content_block_stop") {
            const index = event.index as number;
            const entry = activeTools.get(index);
            if (entry) {
              let parsedInput: Record<string, unknown> | null = null;
              try { parsedInput = JSON.parse(entry.inputChunks.join("")); } catch {}
              yield {
                type: "activity",
                activity: {
                  kind: "tool_end",
                  key: String(index),
                  label: entry.name,
                  input: parsedInput,
                },
              };
              activeTools.delete(index);
            }
          }
        }

        if (msg.type === "assistant" && (msg as any).session_id) {
          yield { type: "session_id", sessionId: (msg as any).session_id };
        }

        if (msg.type === "result") {
          const result = msg as SDKResultSuccess | SDKResultError;
          if (result.session_id) {
            yield { type: "session_id", sessionId: result.session_id };
          }
          yield { type: "result", result: extractResultInfo(result) };
        }
      }
    } finally {
      try { q.close(); } catch {}
    }
  }

  async ephemeralQuery(prompt: string, opts?: EphemeralOpts): Promise<string> {
    const MAX_RETRIES = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0 && opts?.abortController?.signal.aborted) break;

      try {
        const sdkQuery = await getSdkQuery();
        const options: Options = {
          tools: [],
          persistSession: false,
          settingSources: [],
          ...getPermissionOptions(),
          maxTurns: opts?.maxTurns ?? 1,
        };
        if (opts?.model) options.model = opts.model;
        if (opts?.abortController) options.abortController = opts.abortController;

        const q = sdkQuery({ prompt, options });
        let resultText = "";
        let gotMessages = false;

        try {
          for await (const msg of q) {
            gotMessages = true;
            if (msg.type === "result") {
              const result = msg as SDKResultSuccess | SDKResultError;
              if (result.subtype === "success") {
                resultText = (result as SDKResultSuccess).result || "";
              } else {
                throw new Error(`SDK query failed: ${result.subtype}`);
              }
              break;
            }
          }
        } finally {
          q.close();
        }

        if (!gotMessages) {
          lastError = new Error("SDK subprocess produced no messages");
          continue;
        }

        return resultText;
      } catch (e: any) {
        lastError = e;
        if (e.name === "AbortError") throw e;
        if (e.message?.includes("exited with code")) continue;
        throw e;
      }
    }

    throw lastError || new Error("SDK query failed after retries");
  }

  async *toolEnabledStream(prompt: string, opts?: EphemeralOpts): AsyncGenerator<ToolStreamEvent> {
    const sdkQuery = await getSdkQuery();
    const options: Options = {
      settingSources: [],
      ...getPermissionOptions(),
      maxTurns: opts?.maxTurns ?? Infinity,
    };
    if (opts?.model) options.model = opts.model;
    if (opts?.abortController) options.abortController = opts.abortController;
    if (opts?.cwd) options.cwd = opts.cwd;

    const q = sdkQuery({ prompt, options });
    let resultText = "";
    let lastAssistantText = "";
    let gotResult = false;

    try {
      for await (const msg of q) {
        if (msg.type === "assistant" && (msg as any).message?.content) {
          for (const block of (msg as any).message.content) {
            if (block.type === "tool_use") {
              const tool = block.name || "unknown";
              let detail = "";
              if (tool === "Read" && block.input?.file_path) {
                detail = String(block.input.file_path);
              } else if (tool === "Glob" && block.input?.pattern) {
                detail = String(block.input.pattern);
              } else if (tool === "Grep" && block.input?.pattern) {
                detail = `/${block.input.pattern}/` + (block.input.path ? ` in ${block.input.path}` : "");
              } else if (tool === "Bash" && block.input?.command) {
                detail = String(block.input.command).slice(0, 120);
              } else if (tool === "TaskOutput" && block.input?.task_id) {
                detail = `Waiting for task ${block.input.task_id}`;
              } else if (tool === "Write" && block.input?.file_path) {
                detail = String(block.input.file_path);
              } else if (tool === "Edit" && block.input?.file_path) {
                detail = String(block.input.file_path);
              } else if (block.input) {
                detail = JSON.stringify(block.input).slice(0, 120);
              }
              yield { type: "tool_use", tool, detail };
            } else if (block.type === "text" && block.text) {
              lastAssistantText = block.text;
              const snippet = String(block.text).slice(0, 200);
              yield { type: "text", detail: snippet };
            }
          }
        }

        if (msg.type === "assistant" && (msg as any).content) {
          lastAssistantText = String((msg as any).content);
        }

        if (msg.type === "result") {
          gotResult = true;
          const result = msg as SDKResultSuccess | SDKResultError;
          if (result.subtype === "success") {
            resultText = (result as SDKResultSuccess).result || "";
            yield { type: "result", detail: "Completed", resultText };
          } else if (result.subtype === "error_max_turns" && lastAssistantText) {
            resultText = lastAssistantText;
            yield { type: "result", detail: "Completed (max turns)", resultText };
          } else {
            yield { type: "error", detail: `Failed: ${result.subtype}` };
            throw new Error(`SDK query failed: ${result.subtype}`);
          }
          break;
        }
      }
    } finally {
      q.close();
    }

    if (!gotResult) {
      if (lastAssistantText) {
        yield { type: "result", detail: "Completed (subprocess exited)", resultText: lastAssistantText };
      } else {
        yield { type: "error", detail: "Subprocess exited without producing a result" };
        throw new Error("SDK subprocess exited without producing a result");
      }
    }
  }

  listModels(): ModelEntry[] {
    return CLAUDE_MODELS;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await import("@anthropic-ai/claude-agent-sdk");
      return true;
    } catch {
      return false;
    }
  }
}
