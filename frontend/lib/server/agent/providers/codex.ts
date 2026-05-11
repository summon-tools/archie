/**
 * Codex CLI provider adapter.
 * Spawns `codex exec` as a subprocess and parses JSONL output.
 */

import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
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

const CODEX_MODELS: ModelEntry[] = [
  { id: "gpt-5.5", label: "GPT-5.5", provider: "codex" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "codex" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", provider: "codex" },
];

function spawnCodex(
  args: string[],
  cwd?: string,
  abortController?: AbortController,
  stdinData?: string,
): { child: ChildProcess; kill: () => void; errorPromise: Promise<string | null> } {
  const child = spawn("codex", args, {
    cwd: cwd || process.env.HOME || "/tmp",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  const kill = () => {
    try { child.kill("SIGTERM"); } catch {}
  };

  // Capture spawn errors (e.g. command not found)
  const errorPromise = new Promise<string | null>((resolve) => {
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        resolve("Codex CLI is not installed. Install it with: npm install -g @openai/codex");
      } else {
        resolve(`Failed to start Codex CLI: ${err.message}`);
      }
    });
    // Write prompt via stdin once the process is ready
    child.on("spawn", () => {
      if (stdinData && child.stdin) {
        child.stdin.write(stdinData);
        child.stdin.end();
      }
      resolve(null);
    });
  });

  // Collect stderr for error diagnostics
  let stderrBuf = "";
  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString(); });
  }
  (child as any)._stderrBuf = () => stderrBuf;

  if (abortController) {
    const onAbort = () => kill();
    abortController.signal.addEventListener("abort", onAbort, { once: true });
    child.on("exit", () => {
      abortController.signal.removeEventListener("abort", onAbort);
    });
  }

  return { child, kill, errorPromise };
}

async function* readLines(child: ChildProcess): AsyncGenerator<string> {
  const stdout = child.stdout;
  if (!stdout) return;

  let buffer = "";
  for await (const chunk of stdout) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) yield line;
    }
  }
  if (buffer.trim()) yield buffer;
}

/** Wait for the child to exit and return an error message if it failed */
function waitForExit(child: ChildProcess): Promise<string | null> {
  return new Promise((resolve) => {
    child.on("exit", (code) => {
      if (code && code !== 0) {
        const stderr = (child as any)._stderrBuf?.() || "";
        const detail = stderr.trim().split("\n").slice(-3).join("\n").slice(0, 300);
        resolve(detail || `Codex CLI exited with code ${code}`);
      } else {
        resolve(null);
      }
    });
  });
}

// Accumulated state across events for building the final result
interface ParseState {
  threadId: string | null;
  lastText: string;
  allText: string[];
  usage: { input_tokens: number; output_tokens: number } | null;
  sawToolActivity: boolean;
}

export function createParseState(): ParseState {
  return { threadId: null, lastText: "", allText: [], usage: null, sawToolActivity: false };
}

export function extractItemText(item: any): string {
  if (!item || typeof item !== "object") return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.output_text === "string") return item.output_text;

  const chunks: string[] = [];
  if (Array.isArray(item.content)) {
    for (const entry of item.content) {
      if (typeof entry === "string") {
        chunks.push(entry);
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.text === "string") {
        chunks.push(entry.text);
      } else if (typeof entry.content === "string") {
        chunks.push(entry.content);
      }
    }
  }

  return chunks.join("\n\n").trim();
}

// Sentinel value used when the new Codex output format doesn't include a
// thread/session ID.  On resume we detect this and use `--last` instead.
export const CODEX_LAST_SESSION = "__codex_last__";

export function buildResultFromState(
  state: ParseState,
  opts?: { synthesized?: boolean }
): AgentResult {
  const resultText = state.lastText || state.allText.join("\n");
  return {
    text: resultText,
    sessionId: state.threadId || CODEX_LAST_SESSION,
    costUsd: null,
    durationMs: null,
    numTurns: 1,
    usage: state.usage
      ? { inputTokens: state.usage.input_tokens || 0, outputTokens: state.usage.output_tokens || 0 }
      : (opts?.synthesized ? { inputTokens: 0, outputTokens: 0 } : null),
    models: [],
  };
}

export function canSynthesizeSuccess(state: ParseState, exitError: string | null): boolean {
  // If the process exited cleanly (no error), synthesize success when we have
  // any evidence of work: tool activity, captured text, or a thread ID (which
  // means codex at least started processing).
  if (exitError) return false;
  return state.sawToolActivity || !!state.lastText || state.allText.length > 0;
}

function isTransientCodexMessage(message: string): boolean {
  return /reconnecting|retrying|falling back|fallback/i.test(message);
}

export function parseCodexEvent(line: string, state: ParseState): AgentStreamEvent | null {
  let raw: any;
  try { raw = JSON.parse(line); } catch { return null; }

  // Unwrap new envelope format: {"id":"0","msg":{...}}
  const data = raw.msg && typeof raw.msg === "object" && raw.msg.type ? raw.msg : raw;

  // ── Old format events ───────────────────────────────────────────────

  // thread.started — capture session/thread ID
  if (data.type === "thread.started") {
    state.threadId = data.thread_id || null;
    return { type: "session_id", sessionId: data.thread_id || "" };
  }

  // item.started with command_execution — tool starting
  if (data.type === "item.started" && data.item?.type === "command_execution") {
    state.sawToolActivity = true;
    return {
      type: "activity",
      activity: {
        kind: "command",
        key: data.item.id || data.item.command || "command",
        command: data.item.command || "shell",
        status: "started",
      },
    };
  }

  // Non-message items still count as successful work if the process exits cleanly.
  if (
    (data.type === "item.started" || data.type === "item.completed") &&
    data.item?.type &&
    data.item.type !== "agent_message" &&
    data.item.type !== "assistant_message" &&
    data.item.type !== "error"
  ) {
    state.sawToolActivity = true;
  }

  // item.completed with command_execution — tool finished
  if (data.type === "item.completed" && data.item?.type === "command_execution") {
    state.sawToolActivity = true;
    return {
      type: "activity",
      activity: {
        kind: "command",
        key: data.item.id || data.item.command || "command",
        command: data.item.command || "shell",
        status: "completed",
        output: data.item.aggregated_output || "",
      },
    };
  }

  // item.completed with error — surface as first-class error
  if (data.type === "item.completed" && data.item?.type === "error") {
    const errorMsg = data.item.text || data.item.message || "Codex returned an error";
    if (isTransientCodexMessage(errorMsg)) {
      return { type: "activity", activity: { kind: "retry", message: errorMsg } };
    }
    return { type: "error", error: errorMsg };
  }

  if (data.type === "item.completed" && data.item?.type === "file_change") {
    const files = Array.isArray(data.item.changes)
      ? data.item.changes
          .filter((change: any) => change?.path)
          .map((change: any) => ({ path: change.path as string, kind: change.kind || "update" }))
      : [];
    return { type: "activity", activity: { kind: "file_change", key: data.item.id || "file_change", files } };
  }

  // item.completed with text-bearing assistant output
  if (data.type === "item.completed" && data.item?.type !== "command_execution") {
    const text = extractItemText(data.item);
    if (!text) return null;
    state.lastText = text;
    state.allText.push(text);
    return { type: "text", text };
  }

  // turn.started — acknowledged but no event needed
  if (data.type === "turn.started") {
    return { type: "activity", activity: { kind: "status", message: "Codex is working..." } };
  }

  // turn.completed — the turn is done, build result
  if (data.type === "turn.completed") {
    if (data.usage) {
      state.usage = data.usage;
    }
    return { type: "result", result: buildResultFromState(state) };
  }

  // ── New envelope format events ──────────────────────────────────────

  // agent_message — assistant text output
  if (data.type === "agent_message") {
    const text = (data.message || data.text || "").trimEnd();
    if (!text) return null;
    state.lastText = text;
    state.allText.push(text);
    // Emit with a trailing space so consecutive messages flow inline
    // within a single paragraph rather than creating separate <p> blocks.
    return { type: "text", text: text + " " };
  }

  // agent_reasoning — thinking/reasoning (stream as compact status)
  if (data.type === "agent_reasoning") {
    const raw = (data.text || "").replace(/\*\*/g, "").replace(/\n/g, " ").trim();
    if (!raw) return null;
    const summary = raw.length > 120 ? raw.slice(0, 117) + "..." : raw;
    return { type: "activity", activity: { kind: "status", message: `Thinking: ${summary}` } };
  }

  // agent_reasoning_section_break — separator between reasoning blocks
  if (data.type === "agent_reasoning_section_break") {
    return null;
  }

  // exec_command_begin — tool starting
  if (data.type === "exec_command_begin") {
    state.sawToolActivity = true;
    const cmd = Array.isArray(data.command) ? data.command.join(" ") : (data.command || "shell");
    return {
      type: "activity",
      activity: {
        kind: "command",
        key: data.call_id || "command",
        command: cmd,
        status: "started",
      },
    };
  }

  // exec_command_end — tool finished
  if (data.type === "exec_command_end") {
    state.sawToolActivity = true;
    return {
      type: "activity",
      activity: {
        kind: "command",
        key: data.call_id || "command",
        command: "shell",
        status: "completed",
        output: data.stdout || "",
      },
    };
  }

  // exec_command_output_delta — streaming output (skip, too noisy)
  if (data.type === "exec_command_output_delta") {
    return null;
  }

  // token_count — usage stats, treat as end of turn
  if (data.type === "token_count") {
    state.usage = {
      input_tokens: data.input_tokens || 0,
      output_tokens: data.output_tokens || 0,
    };
    // token_count is the last event in the new format — build result
    return { type: "result", result: buildResultFromState(state) };
  }

  // error events
  if (data.type === "error") {
    const message = data.message || data.error || "Unknown error";
    if (isTransientCodexMessage(message)) {
      return { type: "activity", activity: { kind: "retry", message } };
    }
    return { type: "error", error: message };
  }

  return null;
}

function isGitRepo(dir?: string): boolean {
  if (!dir) return false;
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir, timeout: 3000, stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function buildExecArgs(model?: string, cwd?: string): string[] {
  const args = ["exec", "--json", "--full-auto"];
  // Override reasoning effort to avoid inheriting invalid user config values
  args.push("-c", "model_reasoning_effort=high");
  if (!isGitRepo(cwd)) {
    args.push("--skip-git-repo-check");
  }
  if (model) { args.push("--model", model); }
  // Prompt is passed via stdin (using "-") to avoid arg length limits and
  // special character issues with shell escaping.
  args.push("-");
  return args;
}

function getRepoFingerprint(dir?: string): string | null {
  if (!dir || !isGitRepo(dir)) return null;
  try {
    return execSync("git status --porcelain=v1 --untracked-files=all", {
      cwd: dir,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export class CodexCliProvider implements AgentProvider {
  readonly id = "codex";
  readonly label = "Codex CLI";

  async *streamTask(params: StreamTaskParams): AsyncGenerator<AgentStreamEvent> {
    const args = buildExecArgs(params.model, params.cwd);
    const repoFingerprintBefore = getRepoFingerprint(params.cwd);

    const { child, errorPromise } = spawnCodex(args, params.cwd, params.abortController, params.prompt);

    // Check for spawn errors first (e.g. command not found)
    const spawnError = await errorPromise;
    if (spawnError) {
      yield { type: "error", error: spawnError };
      return;
    }

    const exitPromise = waitForExit(child);
    const state = createParseState();

    let gotResult = false;
    for await (const line of readLines(child)) {
      const event = parseCodexEvent(line, state);
      if (event) {
        if (event.type === "result") gotResult = true;
        yield event;
      }
    }

    if (!gotResult) {
      const exitError = await exitPromise;
      const repoFingerprintAfter = getRepoFingerprint(params.cwd);
      const repoChangedDuringRun =
        repoFingerprintBefore !== null &&
        repoFingerprintAfter !== null &&
        repoFingerprintBefore !== repoFingerprintAfter;

      if (canSynthesizeSuccess(state, exitError) || (!exitError && repoChangedDuringRun)) {
        yield { type: "result", result: buildResultFromState(state, { synthesized: true }) };
      } else if (!exitError) {
        // Process exited cleanly (code 0) but we got no parseable output.
        // Synthesize an empty success rather than showing a scary error.
        yield { type: "result", result: buildResultFromState(state, { synthesized: true }) };
      } else {
        const stderrOutput = (child as any)._stderrBuf?.() || "";
        const errorDetail = exitError || stderrOutput.trim();
        yield { type: "error", error: `Codex CLI error: ${errorDetail.slice(0, 500)}` };
      }
    }
  }

  async *resumeSession(params: ResumeSessionParams): AsyncGenerator<AgentStreamEvent> {
    // Codex CLI >=0.22 removed the `resume` subcommand. Fall back to a fresh
    // `exec` session with the full prompt (which already contains conversation
    // context assembled by the caller).
    const args = buildExecArgs(params.model, params.cwd);
    const repoFingerprintBefore = getRepoFingerprint(params.cwd);

    const { child, errorPromise } = spawnCodex(args, params.cwd, params.abortController, params.prompt);

    const spawnError = await errorPromise;
    if (spawnError) {
      yield { type: "error", error: spawnError };
      return;
    }

    const exitPromise = waitForExit(child);
    const state = createParseState();

    let gotResult = false;
    for await (const line of readLines(child)) {
      const event = parseCodexEvent(line, state);
      if (event) {
        if (event.type === "result") gotResult = true;
        yield event;
      }
    }

    if (!gotResult) {
      const exitError = await exitPromise;
      const repoFingerprintAfter = getRepoFingerprint(params.cwd);
      const repoChangedDuringRun =
        repoFingerprintBefore !== null &&
        repoFingerprintAfter !== null &&
        repoFingerprintBefore !== repoFingerprintAfter;

      if (canSynthesizeSuccess(state, exitError) || (!exitError && repoChangedDuringRun)) {
        yield { type: "result", result: buildResultFromState(state, { synthesized: true }) };
      } else if (!exitError) {
        yield { type: "result", result: buildResultFromState(state, { synthesized: true }) };
      } else {
        const stderrOutput = (child as any)._stderrBuf?.() || "";
        const errorDetail = exitError || stderrOutput.trim();
        yield { type: "error", error: `Codex CLI error: ${errorDetail.slice(0, 500)}` };
      }
    }
  }

  async ephemeralQuery(prompt: string, opts?: EphemeralOpts): Promise<string> {
    const args = buildExecArgs(opts?.model, opts?.cwd);

    const { child, errorPromise } = spawnCodex(args, opts?.cwd, opts?.abortController, prompt);

    const spawnError = await errorPromise;
    if (spawnError) throw new Error(spawnError);

    const exitPromise = waitForExit(child);
    let resultText = "";
    const state = createParseState();
    for await (const line of readLines(child)) {
      const event = parseCodexEvent(line, state);
      if (event?.type === "result") {
        resultText = event.result.text;
        break;
      }
      if (event?.type === "text") {
        resultText += event.text;
      }
      if (event?.type === "error") {
        throw new Error(`Codex error: ${event.error}`);
      }
    }

    if (!resultText) {
      const exitError = await exitPromise;
      if (state.lastText || state.allText.length > 0) {
        return buildResultFromState(state, { synthesized: true }).text;
      }

      const stderrOutput = (child as any)._stderrBuf?.() || "";
      const errorDetail = exitError || stderrOutput.trim();
      throw new Error(
        errorDetail
          ? `Codex CLI error: ${errorDetail.slice(0, 500)}`
          : state.sawToolActivity
            ? "Codex CLI completed after tool activity but did not return a final response."
            : "Codex CLI completed without a final response."
      );
    }

    return resultText;
  }

  async *toolEnabledStream(prompt: string, opts?: EphemeralOpts): AsyncGenerator<ToolStreamEvent> {
    const args = buildExecArgs(opts?.model, opts?.cwd);

    const { child, errorPromise } = spawnCodex(args, opts?.cwd, opts?.abortController, prompt);

    const spawnError = await errorPromise;
    if (spawnError) {
      yield { type: "error", detail: spawnError };
      return;
    }

    const exitPromise = waitForExit(child);
    const state = createParseState();
    let gotResult = false;
    for await (const line of readLines(child)) {
      const event = parseCodexEvent(line, state);
      if (!event) continue;

      if (event.type === "activity") {
        if (event.activity.kind === "command") {
          yield {
            type: event.activity.status === "started" ? "tool_use" : "tool_result",
            tool: event.activity.command,
            detail: event.activity.status === "started"
              ? event.activity.command
              : (event.activity.output || "").slice(0, 120) || event.activity.command,
          };
        } else if (event.activity.kind === "file_change") {
          const first = event.activity.files[0]?.path;
          yield {
            type: "tool_result",
            tool: "file_change",
            detail: first ? `Updated ${first}` : "Updated files",
          };
        } else if (event.activity.kind === "progress" || event.activity.kind === "retry" || event.activity.kind === "status") {
          yield { type: "text", detail: event.activity.message.slice(0, 200) };
        }
      } else if (event.type === "text") {
        yield { type: "text", detail: event.text.slice(0, 200) };
      } else if (event.type === "result") {
        gotResult = true;
        yield { type: "result", detail: "Completed", resultText: event.result.text };
      } else if (event.type === "error") {
        yield { type: "error", detail: event.error };
      }
    }

    if (!gotResult) {
      const exitError = await exitPromise;
      if (canSynthesizeSuccess(state, exitError) && (state.lastText || state.allText.length > 0)) {
        yield {
          type: "result",
          detail: "Completed",
          resultText: buildResultFromState(state, { synthesized: true }).text,
        };
      } else {
        const stderrOutput = (child as any)._stderrBuf?.() || "";
        const errorDetail = exitError || stderrOutput.trim();
        if (errorDetail) {
          yield { type: "error", detail: `Codex CLI error: ${errorDetail.slice(0, 500)}` };
        } else if (state.sawToolActivity) {
          yield { type: "error", detail: "Codex CLI completed after tool activity but did not return a final response." };
        }
      }
    }
  }

  listModels(): ModelEntry[] {
    return CODEX_MODELS;
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync("which codex", { stdio: "pipe", timeout: 5000 });
    } catch {
      return false; // Not installed
    }
    try {
      const output = execSync("codex login status 2>&1", {
        encoding: "utf-8",
        shell: "bash",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      });
      return output.includes("Logged in");
    } catch (e: any) {
      // Config errors (e.g. unknown model_reasoning_effort) can cause
      // non-zero exit even when authenticated. Check combined output.
      const combined = String(e.stdout || "") + String(e.stderr || "");
      if (combined.includes("Logged in")) return true;
      return false;
    }
  }
}
