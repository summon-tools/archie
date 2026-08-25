/**
 * Provider-agnostic agent types.
 * All providers (Claude, Codex, etc.) emit these unified event types.
 */

import type { EffortLevel } from "@/lib/effort";

export type AgentStreamEvent =
  | { type: "text"; text: string }
  | { type: "activity"; activity: AgentActivity }
  | { type: "session_id"; sessionId: string }
  | { type: "result"; result: AgentResult }
  | { type: "error"; error: string };

export type AgentActivity =
  | {
      kind: "tool_start" | "tool_end";
      key?: string;
      label: string;
      input?: Record<string, unknown> | null;
    }
  | {
      kind: "command";
      key?: string;
      command: string;
      status: "started" | "completed";
      output?: string;
    }
  | {
      kind: "file_change";
      key?: string;
      files: { path: string; kind: string }[];
    }
  | {
      kind: "progress" | "retry" | "status";
      key?: string;
      message: string;
    };

export interface AgentResult {
  text: string;
  sessionId: string | null;
  costUsd: number | null;
  durationMs: number | null;
  numTurns: number | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  models: string[];
}

export interface StreamTaskParams {
  prompt: string;
  cwd?: string;
  additionalDirectories?: string[];
  model?: string;
  effort?: EffortLevel;
  abortController?: AbortController;
}

export interface ResumeSessionParams extends StreamTaskParams {
  sessionId: string;
}

export interface EphemeralOpts {
  model?: string;
  effort?: EffortLevel;
  maxTurns?: number;
  cwd?: string;
  abortController?: AbortController;
  toolPolicy?: AgentToolPolicy;
}

export type AgentToolPolicy = "full_access" | "read_only_codebase" | "no_tools";

export interface ModelEntry {
  id: string;
  label: string;
  provider: string;
}

/** Mirrors ToolActivity from sdk-helpers — used by background jobs. */
export interface ToolStreamEvent {
  type: "tool_use" | "tool_result" | "text" | "result" | "error";
  tool?: string;
  detail: string;
  resultText?: string;
}

export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  streamTask(params: StreamTaskParams): AsyncIterable<AgentStreamEvent>;
  resumeSession(params: ResumeSessionParams): AsyncIterable<AgentStreamEvent>;
  ephemeralQuery(prompt: string, opts?: EphemeralOpts): Promise<string>;
  toolEnabledStream(prompt: string, opts?: EphemeralOpts): AsyncGenerator<ToolStreamEvent>;
  listModels(): ModelEntry[];
  isAvailable(): Promise<boolean>;
}
