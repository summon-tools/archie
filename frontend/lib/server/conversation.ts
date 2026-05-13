/**
 * Unified agent runner.
 * Conversation-first architecture: all conversations (task, chat, global)
 * route through streamConversationMessage() keyed by conversationId.
 * Provider-agnostic: delegates to AgentProvider implementations.
 */

import { getProvider } from "./agent";
import type { AgentStreamEvent, AgentResult } from "./agent";
import { readSpecIndex, readPrinciples } from "./spec";
import { readSkillsIndex } from "./skills";
import { refreshIfStale } from "./knowledge/indexer";
import { generateWorkItemBrief } from "./knowledge/brief";
import { assembleContext } from "./knowledge/context";
import { TASK_CONTEXT } from "./knowledge/contracts";
import { categorizeFailure, failureMessage } from "./knowledge/failures";
import { getBudget, checkBudget } from "./knowledge/budgets";
import { preflightCheck } from "./knowledge/preflight";
import { execSync } from "child_process";
import * as dal from "./dal";
import { emitConversationEvent } from "./conversation-events";
import { buildConversationSystemPromptBase } from "./prompts/conversation";
import { cleanupMaterializedFilesForContext, formatAttachmentContext, materializeFilesForContext, serializeAppFile } from "./file-storage";
import type { AppFileRow } from "./types";

// In-memory tracking of running queries, keyed by conversationId.
type QueryEntry = { abort: AbortController };
const _g = globalThis as any;
const _conversationQueries: Map<number, QueryEntry> = _g.__conversationQueries ??= new Map();

function uniqueFiles(files: AppFileRow[]): AppFileRow[] {
  const seen = new Set<number>();
  const result: AppFileRow[] = [];
  for (const file of files) {
    if (seen.has(file.id)) continue;
    seen.add(file.id);
    result.push(file);
  }
  return result;
}

function buildConversationAttachmentContext(params: {
  appId: number;
  conversationId: number;
  workItemId?: number | null;
  targetDirectory: string;
}): string {
  const files = uniqueFiles([
    ...dal.getFilesForConversation(params.appId, params.conversationId),
    ...(params.workItemId ? dal.getFilesForWorkItem(params.appId, params.workItemId) : []),
  ]).filter((file) => file.status === "available");
  if (files.length === 0) return "";
  const materialized = materializeFilesForContext({
    appId: params.appId,
    targetDirectory: params.targetDirectory,
    files,
  });
  return formatAttachmentContext(materialized);
}

function abortAllQueries(): void {
  for (const [, entry] of _conversationQueries) {
    try { entry.abort.abort(); } catch {}
  }
  _conversationQueries.clear();
}

const _shutdownKey = "__claude_shutdown_registered__";
if (typeof process !== "undefined" && !(globalThis as any)[_shutdownKey]) {
  (globalThis as any)[_shutdownKey] = true;
  const onExit = () => { abortAllQueries(); };
  process.on("SIGTERM", onExit);
  process.on("SIGINT", onExit);
  process.on("beforeExit", onExit);
}

async function buildConversationSystemPrompt(appId: number, appName: string, directory: string, workItemId?: number): Promise<string> {
  let prompt = buildConversationSystemPromptBase({ appName, directory });

  // Assemble rich context from knowledge layer
  try {
    const ctx = await assembleContext({
      appId,
      directory,
      workItemId,
      needs: TASK_CONTEXT,
    });
    if (ctx.formatted) {
      prompt += `\n\n${ctx.formatted}`;
    }
  } catch {
    // Fallback to legacy spec index + principles if context assembly fails
    const specIndex = readSpecIndex(directory);
    if (specIndex && specIndex.entries.length > 0) {
      prompt += `\n\nThis project has a living specification at .archie/spec/. ` +
        `Read relevant spec files when you need context about features, routes, models, or flows.\n\n` +
        `Spec index:\n${specIndex.entries.map(e => `- ${e.path}: ${e.summary}`).join("\n")}`;
    }
    const principles = readPrinciples(directory);
    if (principles) {
      prompt += `\n\nTeam principles:\n${principles}`;
    }
  }

  // Inject team skills if they exist
  try {
    const skillsIndex = readSkillsIndex(directory);
    if (skillsIndex && skillsIndex.entries.length > 0) {
      prompt += `\n\n## Team Skills\nThe following team conventions are defined in .archie/skills/. Read the full skill file when it is relevant to your current task.\n\n` +
        skillsIndex.entries.map((e) => `- ${e.filename}: ${e.description}`).join("\n");
    }
  } catch {}

  return prompt;
}

function buildMetaLine(result: AgentResult): string {
  const parts: string[] = [];
  const durationS = (result.durationMs || 0) / 1000;
  if (durationS) {
    const mins = Math.floor(durationS / 60);
    const secs = Math.floor(durationS % 60);
    parts.push(mins ? `duration=${mins}m${secs}s` : `duration=${secs}s`);
  }
  if (result.numTurns) parts.push(`turns=${result.numTurns}`);
  if (result.costUsd) parts.push(`cost=$${result.costUsd.toFixed(4)}`);

  if (result.usage) {
    const { inputTokens, outputTokens } = result.usage;
    if (inputTokens || outputTokens) {
      parts.push(`in=${inputTokens}`);
      parts.push(`out=${outputTokens}`);
    }
  }

  if (result.models.length) {
    const short = result.models.map((m) => {
      if (m.includes("haiku")) return "haiku";
      if (m.includes("sonnet")) return "sonnet";
      if (m.includes("opus")) return "opus";
      return m.split("-")[0];
    });
    parts.push(`models=${short.join(",")}`);
  }

  return parts.length ? `\n<!-- meta: ${parts.join(" | ")} -->` : "";
}

function getChangedFilesForSummary(cwd?: string): string[] {
  if (!cwd) return [];

  const commands = [
    "git diff main --name-only --no-color",
    "git diff --name-only --no-color",
    "git status --porcelain=v1 --untracked-files=all",
  ];

  for (const command of commands) {
    try {
      const output = execSync(command, {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (!output) continue;

      const files = output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          if (line.startsWith("?? ")) return line.slice(3).trim();
          if (/^[ MARCUD?!]{1,2}\s+/.test(line)) return line.replace(/^[ MARCUD?!]{1,2}\s+/, "").trim();
          return line;
        })
        .filter(Boolean);

      if (files.length > 0) {
        return Array.from(new Set(files));
      }
    } catch {
      // Try next strategy
    }
  }

  return [];
}

function buildFallbackAssistantResponse(request: string, cwd?: string): string {
  const rawFiles = getChangedFilesForSummary(cwd);
  const hiddenNoise = new Set(["config/database.yml"]);
  const preferredFiles = rawFiles.filter((file) => !hiddenNoise.has(file));
  const files = preferredFiles.length > 0 ? preferredFiles : rawFiles;
  const visibleFiles = files.slice(0, 5);
  const normalizedRequest = request.replace(/\s+/g, " ").trim();

  const lines = ["Completed the requested update."];

  if (normalizedRequest) {
    const shortened = normalizedRequest.length > 140
      ? `${normalizedRequest.slice(0, 137)}...`
      : normalizedRequest;
    lines.push("", `Request: ${shortened}`);
  }

  if (visibleFiles.length > 0) {
    lines.push("");
    lines.push(`Changed ${visibleFiles.length === 1 ? "file" : "files"}:`);
    for (const file of visibleFiles) {
      lines.push(`- \`${file}\``);
    }
    if (files.length > visibleFiles.length) {
      lines.push(`- plus ${files.length - visibleFiles.length} more`);
    }
  }

  return lines.join("\n");
}


// =====================================================================
// Conversation runner — unified for task, chat, and conversation types
// =====================================================================

export function isConversationRunning(conversationId: number): boolean {
  return _conversationQueries.has(conversationId);
}

export async function streamConversationMessage(
  conversationId: number,
  content: string,
  appName: string,
  directory: string,
  model?: string,
  userId?: number,
  retry?: boolean,
  providerId?: string,
  fileIds: number[] = [],
): Promise<ReadableStream<Uint8Array>> {
  // Abort existing query on this conversation
  if (_conversationQueries.has(conversationId)) {
    const existing = _conversationQueries.get(conversationId)!;
    try { existing.abort.abort(); } catch {}
    _conversationQueries.delete(conversationId);
  }

  const conversation = dal.getConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found");

  // Save user message (skip on retry to avoid duplicates)
  if (!retry) {
    const userMsg = dal.createMessage({
      conversation_id: conversationId,
      role: "user",
      kind: "text",
      author_user_id: userId ?? null,
      body_md: content,
    });
    dal.linkAppFiles({
      app_id: conversation.app_id,
      file_ids: fileIds,
      conversation_id: conversationId,
      message_id: userMsg.id,
      link_type: "attachment",
    });
    const attachments = dal.getFilesForMessage(conversation.app_id, userMsg.id).map(serializeAppFile);
    emitConversationEvent(conversationId, {
      type: "message",
      message: { id: userMsg.id, conversation_id: conversationId, role: "user", content, message_type: "text", created_by_name: null, created_by_color: null, created_at: userMsg.created_at, attachments },
    });
  }

  // Get or create agent session
  const session = dal.getSessionForConversation(conversationId);

  // Resolve provider
  const resolvedProviderId = providerId || session?.provider_id || "claude";
  const isProviderSwitch = Boolean(session && providerId && session.provider_id !== resolvedProviderId);
  const sessionId = isProviderSwitch ? undefined : session?.external_session_id || undefined;
  const provider = getProvider(resolvedProviderId);

  // Resolve worktree for task conversations
  const workItem = dal.getWorkItemByConversationId(conversationId);
  let env = workItem ? dal.getWorkItemEnv(workItem.id) : undefined;

  // Wait if worktree is preparing
  if (env?.worktree_status === "preparing") {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      env = dal.getWorkItemEnv(workItem!.id);
      if (env?.worktree_status !== "preparing") break;
    }
  }

  // Lazy worktree creation for task conversations
  if (workItem && !env?.worktree_dir && !env?.worktree_status && directory) {
    if (workItem.kind !== "setup") {
      dal.ensureWorkItemEnv(workItem.id);
      dal.updateWorkItemEnv(workItem.id, { worktree_status: "preparing" });
      try {
        const { createWorktree } = await import("./worktrees");
        const wt = createWorktree(directory, workItem.id, workItem.title);
        if (wt.success) {
          dal.updateWorkItemEnv(workItem.id, {
            worktree_dir: wt.worktree_dir,
            branch_name: wt.branch_name,
            worktree_status: "ready",
          });
          env = dal.getWorkItemEnv(workItem.id);
          // System message: workspace ready
          dal.addSystemMessage(conversationId, `Workspace ready — branch \`${wt.branch_name}\``);
        } else {
          dal.updateWorkItemEnv(workItem.id, { worktree_status: "failed" });
        }
      } catch {
        dal.updateWorkItemEnv(workItem.id, { worktree_status: "failed" });
      }
    }
  }

  const effectiveCwd = env?.worktree_dir || directory || undefined;
  const attachmentContext = effectiveCwd ? buildConversationAttachmentContext({
    appId: conversation.app_id,
    conversationId,
    workItemId: workItem?.id ?? null,
    targetDirectory: effectiveCwd,
  }) : "";
  if (effectiveCwd) {
    try {
      const { capturePlanStepBaseCommitForConversation } = await import("./plan-execution");
      capturePlanStepBaseCommitForConversation({
        appId: conversation.app_id,
        conversationId,
        directory: effectiveCwd,
      });
    } catch {
      // Plan execution can still continue without a scoped base commit.
    }
  }

  // Build prompt
  let prompt: string;
  if (sessionId) {
    // Continued session: include recent context + briefs from previous tasks
    const recentMessages = dal.getConversationMessages(conversationId, 12);
    const prior = recentMessages.slice(0, -1).filter(m => m.role === "user").slice(-10);
    const contextMessages = prior.map(m => `[Team member]: ${m.body_md}`);

    // Inject recent briefs so follow-up tasks know what previous tasks did
    let briefContext = "";
    if (workItem) {
      try {
        const { getRecentBriefs: getBriefs } = await import("./knowledge/brief");
        const briefs = getBriefs(conversation.app_id, 3);
        if (briefs.length > 0) {
          const formatted = briefs.map((b) =>
            `- ${b.brief.goal}${b.brief.files_changed.length ? ` (files: ${b.brief.files_changed.slice(0, 5).join(", ")})` : ""}`
          ).join("\n");
          briefContext = `\n\nRecent task summaries for context:\n${formatted}`;
        }
      } catch {}
    }

    if (contextMessages.length > 0) {
      prompt = `Here is the recent team discussion for context:\n\n${contextMessages.join("\n\n")}${briefContext}${attachmentContext ? `\n\n${attachmentContext}` : ""}\n\nNow the user asks:\n${content}\n\nIMPORTANT: If this request is ambiguous or you need more information before implementing, ask clarifying questions first instead of guessing.`;
    } else {
      prompt = `${briefContext ? briefContext + "\n\n" : ""}${attachmentContext ? attachmentContext + "\n\n" : ""}${content}\n\nIMPORTANT: If this request is ambiguous or you need more information before implementing, ask clarifying questions first instead of guessing.`;
    }
  } else if (conversation.kind === "task" && workItem) {
    const systemPrompt = await buildConversationSystemPrompt(conversation.app_id, appName, effectiveCwd || directory, workItem.id);
    const taskDescription = workItem.summary || "";

    if (taskDescription && taskDescription !== content) {
      prompt = `${systemPrompt}\n\n---\n\nTask instructions:\n${taskDescription}${attachmentContext ? `\n\n${attachmentContext}` : ""}\n\n---\n\nUser message:\n${content}`;
    } else {
      prompt = `${systemPrompt}\n\n---\n\n${attachmentContext ? `${attachmentContext}\n\n` : ""}User task request:\n${content}`;
    }
  } else {
    // Chat or conversation type — just pass the message
    prompt = `${attachmentContext ? `${attachmentContext}\n\n` : ""}${content}`;
  }

  // Preflight check
  const preflight = await preflightCheck({
    appId: conversation.app_id,
    directory: effectiveCwd || directory,
    workItemId: workItem?.id,
    workflow: "stream",
  });
  if (!preflight.ok) {
    const errorMsg = preflight.blockers.join("; ");
    if (effectiveCwd) {
      cleanupMaterializedFilesForContext({ appId: conversation.app_id, targetDirectory: effectiveCwd });
    }
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`));
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ session_id: "" })}\n\n`));
        controller.close();
      },
    });
  }

  // Update session status and provider
  dal.upsertSessionForConversation(conversationId, {
    status: "running",
    provider_id: resolvedProviderId,
    ...(isProviderSwitch ? { external_session_id: null } : {}),
  });
  emitConversationEvent(conversationId, { type: "status", status: "running" });

  // Create a run record with budget
  const budget = getBudget("stream");
  const run = dal.createRun({
    app_id: conversation.app_id,
    conversation_id: conversationId,
    work_item_id: workItem?.id ?? null,
    session_id: session?.id ?? null,
    workflow_key: "stream",
    status: "running",
    provider_id: resolvedProviderId,
    model_id: model || null,
    input_json: JSON.stringify({ content }),
    budget_json: JSON.stringify(budget),
  });

  const abortController = new AbortController();
  _conversationQueries.set(conversationId, { abort: abortController });

  const streamCwd = conversation.kind === "conversation" ? (process.env.HOME || "/tmp") : effectiveCwd;

  // Get the event stream from the provider
  const events = sessionId
    ? provider.resumeSession({ prompt, cwd: streamCwd, model, sessionId, abortController })
    : provider.streamTask({ prompt, cwd: streamCwd, model, abortController });

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let resultSessionId: string | null = sessionId || null;
      let controllerOpen = true;

      const safeEnqueue = (data: string) => {
        if (!controllerOpen) return;
        try { controller.enqueue(encoder.encode(data)); } catch { controllerOpen = false; }
      };

      try {
        for await (const event of events) {
          switch (event.type) {
            case "text":
              safeEnqueue(`event: text\ndata: ${JSON.stringify({ text: event.text })}\n\n`);
              break;

            case "activity":
              safeEnqueue(`event: activity\ndata: ${JSON.stringify(event.activity)}\n\n`);
              break;

            case "session_id":
              resultSessionId = event.sessionId;
              break;

            case "result": {
              const agentResult = event.result;
              if (agentResult.sessionId) resultSessionId = agentResult.sessionId;

              // Check budget
              const budgetCheck = checkBudget(budget, {
                numTurns: agentResult.numTurns ?? undefined,
                durationMs: agentResult.durationMs ?? undefined,
                costUsd: agentResult.costUsd ?? undefined,
              });

              // A result event means the provider completed — treat as success
              // even if text is empty (e.g. Codex did only tool calls) or costUsd is null
              const isSuccess = agentResult.text !== "" || agentResult.costUsd !== null || agentResult.usage !== null;
              if (isSuccess) {
                const metaLine = buildMetaLine(agentResult);
                const responseBody = agentResult.text.trim()
                  ? agentResult.text
                  : buildFallbackAssistantResponse(content, effectiveCwd || directory);

                // Save assistant response with model attribution
                const assistantMsg = dal.createMessage({
                  conversation_id: conversationId,
                  role: "assistant",
                  kind: "text",
                  body_md: responseBody + metaLine,
                  model_id: model || null,
                  provider_id: resolvedProviderId || null,
                });
                emitConversationEvent(conversationId, {
                  type: "message",
                  message: { id: assistantMsg.id, conversation_id: conversationId, role: "assistant", content: responseBody + metaLine, message_type: "text", created_by_name: null, created_by_color: null, created_at: assistantMsg.created_at },
                });

                // Update session
                dal.upsertSessionForConversation(conversationId, {
                  external_session_id: resultSessionId,
                  status: "completed",
                });
                emitConversationEvent(conversationId, { type: "status", status: "completed" });

                // Update run with budget check results
                const runUpdate: Parameters<typeof dal.updateRun>[1] = {
                  status: "completed",
                  result_json: JSON.stringify({
                    cost: agentResult.costUsd,
                    duration_ms: agentResult.durationMs,
                    num_turns: agentResult.numTurns,
                  }),
                };
                if (budgetCheck.exceeded) {
                  runUpdate.failure_category = "budget_exceeded";
                }
                dal.updateRun(run.id, runUpdate);

                try {
                  const {
                    scheduleAutomatedPlanStepGates,
                    startPlanStepGatesForCompletedConversation,
                  } = await import("./plan-execution");
                  const gateResult = startPlanStepGatesForCompletedConversation({
                    appId: conversation.app_id,
                    conversationId,
                  });
                  if (gateResult) {
                    const planRoom = dal.getRoom(gateResult.plan.room_id);
                    if (planRoom) {
                      scheduleAutomatedPlanStepGates({
                        appId: conversation.app_id,
                        roomId: planRoom.id,
                        stepId: gateResult.step.id,
                      });
                    }
                  }
                } catch {
                  // Plan execution advancement is best-effort here. The
                  // conversation result is already persisted and should still
                  // complete even if the plan linkage is stale.
                }

                safeEnqueue(`event: status\ndata: ${JSON.stringify({ status: "completed" })}\n\n`);

                // Fire-and-forget: generate brief immediately, defer heavier work
                const taskCwd = effectiveCwd || directory;
                if (workItem) {
                  generateWorkItemBrief(conversation.app_id, workItem.id, run.id, taskCwd || directory).catch(() => {});
                }
                if (taskCwd) {
                  // Defer knowledge refresh so it doesn't compete with brief generation
                  setTimeout(() => {
                    refreshIfStale(conversation.app_id, taskCwd).catch(() => {});
                  }, 3_000);
                }
              } else {
                dal.upsertSessionForConversation(conversationId, {
                  external_session_id: resultSessionId,
                  status: "failed",
                });
                emitConversationEvent(conversationId, { type: "status", status: "failed" });
                dal.updateRun(run.id, { status: "failed", error_text: "no result" });
                safeEnqueue(`event: status\ndata: ${JSON.stringify({ status: "failed" })}\n\n`);
              }
              break;
            }

            case "error": {
              const category = categorizeFailure(event.error);
              dal.upsertSessionForConversation(conversationId, {
                external_session_id: resultSessionId,
                status: "failed",
              });
              emitConversationEvent(conversationId, { type: "status", status: "failed" });
              dal.updateRun(run.id, { status: "failed", error_text: event.error, failure_category: category });
              safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: failureMessage(category), category, detail: event.error })}\n\n`);
              break;
            }
          }
        }

        safeEnqueue(`event: done\ndata: ${JSON.stringify({ session_id: resultSessionId || "" })}\n\n`);
      } catch (e: any) {
        const category = categorizeFailure(e);
        const status = category === "abort" ? "stopped" : "failed";
        dal.upsertSessionForConversation(conversationId, { status });
        emitConversationEvent(conversationId, { type: "status", status });
        dal.updateRun(run.id, { status, error_text: e.message || String(e), failure_category: category });

        if (category !== "abort") {
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: failureMessage(category), category, detail: e.message || String(e) })}\n\n`);
        }
      } finally {
        if (effectiveCwd) {
          cleanupMaterializedFilesForContext({ appId: conversation.app_id, targetDirectory: effectiveCwd });
        }
        _conversationQueries.delete(conversationId);
        try { controller.close(); } catch {}
      }
    },
  });
}

export function getConversationStatus(conversationId: number): {
  claude_status: string | null;
  claude_log: string;
  claude_mode: string | null;
  claude_pending_prompt: string | null;
} {
  const session = dal.getSessionForConversation(conversationId);
  const isRunning = _conversationQueries.has(conversationId);
  return {
    claude_status: isRunning ? "running" : (session?.status || null),
    claude_log: "",
    claude_mode: null,
    claude_pending_prompt: null,
  };
}

export function stopConversation(conversationId: number): void {
  const entry = _conversationQueries.get(conversationId);
  if (entry) {
    try { entry.abort.abort(); } catch {}
    _conversationQueries.delete(conversationId);
  }
  dal.upsertSessionForConversation(conversationId, { status: "stopped" });
  emitConversationEvent(conversationId, { type: "status", status: "stopped" });
}

export function getConversationMessages(
  conversationId: number,
  limit = 200
): {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  message_type: string;
  created_by: number | null;
  created_by_name: string | null;
  created_by_color: string | null;
  created_at: string;
}[] {
  const messages = dal.getConversationMessages(conversationId, limit);
  return messages.map(m => ({
    id: m.id,
    conversation_id: m.conversation_id,
    role: m.role,
    content: m.body_md,
    message_type: m.kind,
    created_by: m.author_user_id,
    created_by_name: m.author_name || null,
    created_by_color: m.author_color || null,
    created_at: m.created_at,
  }));
}
