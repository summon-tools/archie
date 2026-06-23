import { execFileSync } from "child_process";
import path from "path";
import { getProvider } from "@/lib/server/agent";
import { getModelForCategory, type ModelCategory } from "@/lib/server/config";
import { startApp, stopApp, checkPortSync } from "@/lib/server/apps";
import * as dal from "@/lib/server/dal";
import { getDb } from "@/lib/server/db";
import { readManifest } from "@/lib/server/manifest";
import { getActiveProcess, listProcesses } from "@/lib/server/dal/processes";
import { readSkillsIndex } from "@/lib/server/skills";
import { stopConversation } from "@/lib/server/conversation";
import { startBackgroundConversationRun } from "@/lib/server/conversation-runner";
import { allocatePort, getPreviewStatus, startPreview, stopPreview } from "@/lib/server/worktrees";
import type { AppRow, ConversationRow, MessageRow, RunRow, WorkItemRow } from "@/lib/server/types";
import {
  type McpPrincipal,
  requireMcpAppAccess,
  requireMcpAppScope,
  requireMcpScope,
} from "./auth";
import {
  isObject,
  McpToolError,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireNumber,
  requireString,
} from "./errors";
import { mcpTextResult, type McpToolResult } from "./protocol";

interface McpHandlerContext {
  principal: McpPrincipal;
  baseUrl: string;
}

type ToolHandler = (args: Record<string, unknown>, ctx: McpHandlerContext) => Promise<McpToolResult>;

function getArgs(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function resolveModelSelection(args: Record<string, unknown>, category: ModelCategory): { provider: string; model?: string } {
  const configured = getModelForCategory(category);
  const requestedProvider = optionalString(args.provider, "provider");
  const requestedModel = optionalString(args.model, "model");
  const provider = requestedProvider || configured.provider;
  const model = requestedModel || (!requestedProvider || requestedProvider === configured.provider ? configured.model : undefined);
  return { provider, model };
}

function proxyUrl(baseUrl: string, port: number | null | undefined): string | null {
  return port ? `${baseUrl.replace(/\/+$/, "")}/api/p/${port}` : null;
}

function getVisibleApps(principal: McpPrincipal): AppRow[] {
  const apps = dal.getApps();
  if (principal.allowedAppIds.size === 0) return apps;
  return apps.filter((app) => principal.allowedAppIds.has(app.id));
}

function appOrThrow(appId: number, principal: McpPrincipal, scope: Parameters<typeof requireMcpAppScope>[2]): AppRow {
  requireMcpAppScope(principal, appId, scope);
  const app = dal.getApp(appId);
  if (!app) throw new McpToolError(`App ${appId} not found`, 404);
  return app;
}

function appFramework(app: AppRow): string | null {
  if (!app.directory) return null;
  return readManifest(app.directory)?.app?.framework ?? null;
}

function appSummary(app: AppRow, ctx: McpHandlerContext) {
  const response = dal.buildAppResponse(app);
  return {
    app_id: app.id,
    name: app.name,
    description: app.description,
    framework: appFramework(app),
    directory_label: app.directory ? path.basename(app.directory.replace(/\/+$/, "")) : "",
    default_port: app.port,
    github_repo: app.github_repo || null,
    is_running: response.is_running,
    app_url: response.is_running ? proxyUrl(ctx.baseUrl, app.port) : null,
    work_item_counts: response.work_item_counts,
    conversation_stats: response.conversation_stats,
    created_at: app.created_at,
  };
}

function latestRunForConversation(conversationId: number): RunRow | undefined {
  return dal.getLatestRunForConversation(conversationId);
}

function latestRunForWorkItem(workItemId: number): RunRow | undefined {
  return getDb()
    .prepare("SELECT * FROM runs WHERE work_item_id = ? ORDER BY id DESC LIMIT 1")
    .get(workItemId) as RunRow | undefined;
}

function runByIdentifier(args: Record<string, unknown>): {
  run?: RunRow;
  conversation?: ConversationRow;
  workItem?: WorkItemRow;
} {
  const runId = optionalNumber(args.run_id, "run_id");
  const conversationId = optionalNumber(args.conversation_id, "conversation_id");
  const taskId = optionalNumber(args.task_id, "task_id");
  if (!runId && !conversationId && !taskId) {
    throw new McpToolError("One of run_id, conversation_id, or task_id is required");
  }

  let run: RunRow | undefined;
  let conversation: ConversationRow | undefined;
  let workItem: WorkItemRow | undefined;

  if (runId) {
    run = dal.getRun(runId);
    if (!run) throw new McpToolError(`Run ${runId} not found`, 404);
    if (run.conversation_id) conversation = dal.getConversation(run.conversation_id);
    if (run.work_item_id) workItem = dal.getWorkItem(run.work_item_id);
  } else if (conversationId) {
    conversation = dal.getConversation(conversationId);
    if (!conversation) throw new McpToolError(`Conversation ${conversationId} not found`, 404);
    workItem = dal.getWorkItemByConversationId(conversationId);
    run = latestRunForConversation(conversationId);
  } else if (taskId) {
    workItem = dal.getWorkItem(taskId);
    if (!workItem) throw new McpToolError(`Task ${taskId} not found`, 404);
    if (workItem.primary_conversation_id) conversation = dal.getConversation(workItem.primary_conversation_id);
    run = latestRunForWorkItem(taskId);
  }

  return { run, conversation, workItem };
}

function latestAssistantMessage(conversationId: number | null | undefined): MessageRow | undefined {
  if (!conversationId) return undefined;
  return getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY seq DESC, id DESC LIMIT 1")
    .get(conversationId) as MessageRow | undefined;
}

function recentMessages(conversationId: number, limit = 12) {
  return dal.getConversationMessages(conversationId, limit).map((message) => ({
    id: message.id,
    role: message.role,
    body_md: message.body_md,
    created_at: message.created_at,
  }));
}

function changedFilesForWorkItem(workItem?: WorkItemRow): string[] {
  if (!workItem) return [];
  const env = dal.getWorkItemEnv(workItem.id);
  if (!env?.worktree_dir) return [];
  const cwd = env.worktree_dir;
  const runGit = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).split("\n").map((line) => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  };
  return Array.from(new Set([
    ...runGit(["diff", "--name-only", "HEAD"]),
    ...runGit(["diff", "--name-only", "--cached"]),
    ...runGit(["ls-files", "--others", "--exclude-standard"]),
  ])).sort();
}

function taskPreviewUrl(workItem: WorkItemRow | undefined, ctx: McpHandlerContext): string | null {
  if (!workItem) return null;
  const env = dal.getWorkItemEnv(workItem.id);
  if (!env?.preview_port) return null;
  const status = getPreviewStatus(env.preview_port);
  return status.running ? proxyUrl(ctx.baseUrl, env.preview_port) : null;
}

function taskStatusPayload(args: Record<string, unknown>, ctx: McpHandlerContext, resultOnly = false) {
  const { run, conversation, workItem } = runByIdentifier(args);
  const appId = run?.app_id ?? conversation?.app_id ?? workItem?.app_id;
  if (!appId) throw new McpToolError("Could not resolve app for task", 404);
  requireMcpAppScope(ctx.principal, appId, "tasks:read");

  const assistant = latestAssistantMessage(run?.conversation_id ?? conversation?.id);
  const env = workItem ? dal.getWorkItemEnv(workItem.id) : undefined;
  const status = run?.status ?? "unknown";
  const payload: Record<string, unknown> = {
    status,
    run_id: run?.id ?? null,
    conversation_id: conversation?.id ?? run?.conversation_id ?? null,
    task_id: workItem?.id ?? run?.work_item_id ?? null,
    app_id: appId,
    title: workItem?.title ?? conversation?.title ?? null,
    branch_name: env?.branch_name ?? null,
    preview_url: taskPreviewUrl(workItem, ctx),
    updated_at: run?.updated_at ?? conversation?.updated_at ?? workItem?.updated_at ?? null,
  };

  if (status === "running") {
    payload.progress = run?.progress_text || "Task is running";
    payload.next_poll_after_seconds = 10;
  } else if (status === "completed") {
    payload.final_response = assistant?.body_md ?? "";
    payload.files_changed = changedFilesForWorkItem(workItem);
    payload.pr_url = null;
  } else if (status === "failed" || status === "stopped") {
    payload.error = run?.error_text || (status === "stopped" ? "Task was stopped" : "Task failed");
    payload.failure_category = run?.failure_category ?? null;
    payload.can_continue = Boolean(conversation?.id);
  } else if (!run) {
    payload.status = "no_run";
    payload.progress = "No run has been started for this task yet";
  }

  if (!resultOnly && optionalBoolean(args.include_messages, "include_messages") && conversation?.id) {
    payload.messages = recentMessages(conversation.id);
  }
  if (!resultOnly && optionalBoolean(args.include_activity, "include_activity")) {
    payload.activity = run?.progress_text ? [run.progress_text] : [];
  }

  return payload;
}

function taskStartPayload(run: RunRow, conversation: ConversationRow, workItem: WorkItemRow | undefined) {
  return {
    status: run.status,
    app_id: run.app_id,
    task_id: workItem?.id ?? run.work_item_id ?? null,
    conversation_id: conversation.id,
    run_id: run.id,
    next_poll_after_seconds: run.status === "running" ? 5 : undefined,
    status_hint: run.status === "running" ? `Call archie_get_task_status with run_id=${run.id}.` : undefined,
  };
}

async function listApps(_args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  requireMcpScope(ctx.principal, "apps:read");
  const apps = getVisibleApps(ctx.principal).map((app) => appSummary(app, ctx));
  return mcpTextResult(`Found ${apps.length} Archie app${apps.length === 1 ? "" : "s"}.`, { apps });
}

async function getApp(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const appId = requireNumber(args.app_id, "app_id");
  const app = appOrThrow(appId, ctx.principal, "apps:read");
  const processes = listProcesses(app.id).slice(0, 10).map((process) => ({
    id: process.id,
    kind: process.kind,
    work_item_id: process.work_item_id,
    port: process.port,
    status: process.status,
    url: process.status === "running" ? proxyUrl(ctx.baseUrl, process.port) : null,
    started_at: process.started_at,
    stopped_at: process.stopped_at,
  }));
  const payload = { app: appSummary(app, ctx), processes };
  return mcpTextResult(`App ${app.name} is available.`, payload);
}

async function listSkills(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  requireMcpScope(ctx.principal, "skills:read");
  const appId = optionalNumber(args.app_id, "app_id");
  const scope = optionalString(args.scope, "scope") ?? "all";
  const enabledOnly = optionalBoolean(args.enabled_only, "enabled_only") ?? true;
  if (!["global", "project", "all"].includes(scope)) {
    throw new McpToolError("scope must be global, project, or all");
  }
  if (appId) requireMcpAppAccess(ctx.principal, appId);

  const skills: Record<string, unknown>[] = [];
  if (scope === "global" || scope === "all") {
    skills.push(...dal.listGlobalSkills({ enabledOnly }).map((skill) => ({
      slug_or_filename: skill.slug,
      name: skill.name,
      description: skill.description,
      scope: "global",
      enabled: skill.enabled,
      trigger_phrases: skill.trigger_phrases,
    })));
  }
  if (appId && (scope === "project" || scope === "all")) {
    const app = appOrThrow(appId, ctx.principal, "skills:read");
    const index = app.directory ? readSkillsIndex(app.directory) : null;
    skills.push(...(index?.entries ?? []).map((skill) => ({
      slug_or_filename: skill.filename,
      name: skill.name,
      description: skill.description,
      scope: "project",
      enabled: true,
      trigger_phrases: [],
    })));
  }

  return mcpTextResult(`Found ${skills.length} skill${skills.length === 1 ? "" : "s"}.`, { skills });
}

async function askProject(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const appId = requireNumber(args.app_id, "app_id");
  const question = requireString(args.question, "question");
  const app = appOrThrow(appId, ctx.principal, "project:read");
  requireMcpScope(ctx.principal, "apps:read");
  const { provider: providerId, model } = resolveModelSelection(args, "background");
  const provider = getProvider(providerId);
  const prompt = [
    `Answer this question about the Archie app "${app.name}".`,
    "Use read-only codebase inspection. Do not edit files, run mutating commands, install dependencies, start servers, commit, or push.",
    "Cite relevant file paths in the answer when possible.",
    "",
    question,
  ].join("\n");
  const answer = await provider.ephemeralQuery(prompt, {
    cwd: app.directory,
    model,
    toolPolicy: "read_only_codebase",
  });
  return mcpTextResult(answer, { answer, app_id: app.id, provider: providerId, model: model ?? null });
}

async function listTasks(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const appId = requireNumber(args.app_id, "app_id");
  appOrThrow(appId, ctx.principal, "tasks:read");
  const status = optionalString(args.status, "status") ?? "all";
  const limit = optionalNumber(args.limit, "limit") ?? 25;
  const items = dal.getConversationsForApp(appId).map((conversation) => {
    const run = latestRunForConversation(conversation.id);
    const workItem = conversation.work_item_id ? dal.getWorkItem(conversation.work_item_id) : undefined;
    return {
      task_id: conversation.work_item_id,
      conversation_id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      work_item_status: conversation.work_item_status,
      latest_run_status: run?.status ?? null,
      branch_name: conversation.branch_name,
      preview_url: taskPreviewUrl(workItem, ctx),
      pr_url: conversation.pr_url,
      updated_at: conversation.last_message_at ?? conversation.created_at,
    };
  }).filter((item) => {
    if (status === "all") return true;
    if (status === "running" || status === "completed" || status === "failed") {
      return item.latest_run_status === status;
    }
    return item.status === status;
  }).slice(0, Math.min(limit, 100));
  return mcpTextResult(`Found ${items.length} task${items.length === 1 ? "" : "s"}.`, { tasks: items });
}

async function getTaskStatus(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const payload = taskStatusPayload(args, ctx);
  return mcpTextResult(`Task status: ${payload.status}`, payload);
}

async function getTaskResult(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const payload = taskStatusPayload(args, ctx, true);
  if (payload.status !== "completed") {
    return mcpTextResult(`Task is ${String(payload.status)}. Call archie_get_task_status for details.`, payload);
  }
  return mcpTextResult(String(payload.final_response || "Task completed."), payload);
}

async function listActivity(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  requireMcpScope(ctx.principal, "activity:read");
  const appId = optionalNumber(args.app_id, "app_id");
  if (appId) requireMcpAppAccess(ctx.principal, appId);
  const visibleAppIds = new Set(getVisibleApps(ctx.principal).map((app) => app.id));
  const activeRuns = dal.getActiveRuns()
    .filter((run) => (!appId || run.app_id === appId) && visibleAppIds.has(run.app_id))
    .map((run) => ({
      run_id: run.id,
      app_id: run.app_id,
      conversation_id: run.conversation_id,
      task_id: run.work_item_id,
      workflow_key: run.workflow_key,
      provider_id: run.provider_id,
      model_id: run.model_id,
      progress: run.progress_text,
      started_at: run.created_at,
    }));
  const processRows = (getDb()
    .prepare("SELECT * FROM managed_processes WHERE status = 'running' ORDER BY started_at DESC")
    .all() as ReturnType<typeof listProcesses>)
    .filter((process) => (!appId || process.app_id === appId) && visibleAppIds.has(process.app_id))
    .map((process) => ({
      id: process.id,
      app_id: process.app_id,
      task_id: process.work_item_id,
      kind: process.kind,
      port: process.port,
      url: proxyUrl(ctx.baseUrl, process.port),
      started_at: process.started_at,
    }));
  const payload = { active_runs: activeRuns, active_processes: processRows };
  return mcpTextResult(`Found ${activeRuns.length} active run(s) and ${processRows.length} active process(es).`, payload);
}

async function startTask(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const appId = requireNumber(args.app_id, "app_id");
  const prompt = requireString(args.prompt, "prompt");
  const app = appOrThrow(appId, ctx.principal, "tasks:write");
  const title = optionalString(args.title, "title") || prompt.slice(0, 80);
  const skillSlug = optionalString(args.skill_slug, "skill_slug");
  let content = prompt;
  if (skillSlug) {
    const skill = dal.getGlobalSkillBySlug(skillSlug);
    if (!skill || !skill.enabled) throw new McpToolError(`Enabled global skill not found: ${skillSlug}`, 404);
    content = `/${skill.slug}\n\n${prompt}`;
  }

  const conversation = dal.createConversation({
    app_id: app.id,
    kind: "task",
    title,
    created_by: ctx.principal.createdByUserId,
    origin_type: "mcp",
  });
  const workItem = dal.createWorkItem({
    app_id: app.id,
    primary_conversation_id: conversation.id,
    title,
    summary: prompt,
    created_by: ctx.principal.createdByUserId,
    origin_type: "mcp",
  });
  const run = await startBackgroundConversationRun({
    conversationId: conversation.id,
    content,
    app,
    userId: ctx.principal.createdByUserId,
    ...resolveModelSelection(args, "chat"),
    waitSeconds: optionalNumber(args.wait_seconds, "wait_seconds") ?? 0,
  });
  const payload = run.status === "completed"
    ? taskStatusPayload({ run_id: run.id }, ctx, true)
    : taskStartPayload(run, conversation, workItem);
  return mcpTextResult(`Task ${workItem.id} ${run.status === "completed" ? "completed" : "started"}.`, payload);
}

async function continueTask(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const conversationId = requireNumber(args.conversation_id, "conversation_id");
  const prompt = requireString(args.prompt, "prompt");
  const conversation = dal.getConversation(conversationId);
  if (!conversation) throw new McpToolError(`Conversation ${conversationId} not found`, 404);
  const app = appOrThrow(conversation.app_id, ctx.principal, "tasks:write");
  const workItem = dal.getWorkItemByConversationId(conversationId);
  if (conversation.kind !== "task" || !workItem) {
    throw new McpToolError("archie_continue_task can only continue task conversations", 400);
  }
  const run = await startBackgroundConversationRun({
    conversationId,
    content: prompt,
    app,
    userId: ctx.principal.createdByUserId,
    ...resolveModelSelection(args, "chat"),
    waitSeconds: optionalNumber(args.wait_seconds, "wait_seconds") ?? 0,
  });
  const payload = run.status === "completed"
    ? taskStatusPayload({ run_id: run.id }, ctx, true)
    : taskStartPayload(run, conversation, workItem);
  return mcpTextResult(`Conversation ${conversationId} ${run.status === "completed" ? "completed" : "continued"}.`, payload);
}

async function stopTask(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const conversationId = requireNumber(args.conversation_id, "conversation_id");
  const conversation = dal.getConversation(conversationId);
  if (!conversation) throw new McpToolError(`Conversation ${conversationId} not found`, 404);
  if (conversation.kind !== "task" || !dal.getWorkItemByConversationId(conversationId)) {
    throw new McpToolError("archie_stop_task can only stop task conversations", 400);
  }
  requireMcpAppScope(ctx.principal, conversation.app_id, "tasks:stop");
  stopConversation(conversationId);
  return mcpTextResult(`Stopped conversation ${conversationId}.`, {
    status: "stopped",
    conversation_id: conversationId,
  });
}

async function startServer(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const appId = requireNumber(args.app_id, "app_id");
  const app = appOrThrow(appId, ctx.principal, "servers:start");
  if (app.port && checkPortSync(app.port)) {
    const payload = { status: "running", port: app.port, url: proxyUrl(ctx.baseUrl, app.port), message: "App is already running" };
    return mcpTextResult(payload.message, payload);
  }
  const result = startApp(app.directory, app.port, app.id);
  if (!result.success) throw new McpToolError(result.message, 500);
  const payload = { status: "running", port: app.port, url: proxyUrl(ctx.baseUrl, app.port), message: result.message };
  return mcpTextResult(result.message, payload);
}

async function startTaskPreview(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const appId = requireNumber(args.app_id, "app_id");
  const taskIdValue = requireNumber(args.task_id, "task_id");
  const app = appOrThrow(appId, ctx.principal, "servers:start");
  const workItem = dal.getWorkItem(taskIdValue);
  if (!workItem || workItem.app_id !== app.id) throw new McpToolError(`Task ${taskIdValue} not found`, 404);
  const env = dal.getWorkItemEnv(workItem.id);
  const previewDir = env?.worktree_dir || app.directory;
  if (!previewDir) throw new McpToolError("No directory available for preview");
  const usedPorts = (
    getDb()
      .prepare("SELECT preview_port FROM work_item_env WHERE preview_port IS NOT NULL AND work_item_id != ?")
      .all(workItem.id) as { preview_port: number }[]
  ).map((row) => row.preview_port);
  const port = allocatePort(usedPorts);
  if (!port) throw new McpToolError("No available ports for preview", 503);
  dal.ensureWorkItemEnv(workItem.id);
  const result = await startPreview(previewDir, port, undefined, { appId: app.id, workItemId: workItem.id });
  if (!result.success) throw new McpToolError(result.message, 500);
  dal.updateWorkItemEnv(workItem.id, { preview_port: port, preview_pid: result.pid });
  const payload = {
    status: "running",
    port,
    pid: result.pid,
    url: proxyUrl(ctx.baseUrl, port),
    healthy: result.healthy,
    status_code: result.statusCode,
    message: result.message,
  };
  return mcpTextResult(result.message, payload);
}

async function stopServer(args: Record<string, unknown>, ctx: McpHandlerContext): Promise<McpToolResult> {
  const appId = requireNumber(args.app_id, "app_id");
  const app = appOrThrow(appId, ctx.principal, "servers:stop");
  const kind = optionalString(args.kind, "kind") || (args.task_id ? "preview" : "app");
  if (kind !== "app" && kind !== "preview") throw new McpToolError("kind must be app or preview");
  if (kind === "preview") {
    const taskIdValue = requireNumber(args.task_id, "task_id");
    const workItem = dal.getWorkItem(taskIdValue);
    if (!workItem || workItem.app_id !== app.id) throw new McpToolError(`Task ${taskIdValue} not found`, 404);
    const env = dal.getWorkItemEnv(workItem.id);
    const result = stopPreview(env?.preview_pid ?? null, env?.worktree_dir || app.directory, env?.preview_port ?? null, {
      appId: app.id,
      workItemId: workItem.id,
    });
    dal.updateWorkItemEnv(workItem.id, { preview_pid: null, preview_port: null });
    return mcpTextResult(result.message, { status: result.success ? "stopped" : "failed", message: result.message });
  }
  const proc = getActiveProcess(app.id, "app");
  const result = stopApp(app.directory, app.port, app.id);
  return mcpTextResult(result.message, {
    status: result.success ? "stopped" : "failed",
    process_id: proc?.id ?? null,
    message: result.message,
  }, !result.success);
}

const HANDLERS: Record<string, ToolHandler> = {
  archie_list_apps: listApps,
  archie_get_app: getApp,
  archie_list_skills: listSkills,
  archie_ask_project: askProject,
  archie_list_tasks: listTasks,
  archie_get_task_status: getTaskStatus,
  archie_get_task_result: getTaskResult,
  archie_list_activity: listActivity,
  archie_start_task: startTask,
  archie_continue_task: continueTask,
  archie_stop_task: stopTask,
  archie_start_server: startServer,
  archie_start_preview: startTaskPreview,
  archie_stop_server: stopServer,
};

export async function callMcpTool(
  name: string,
  rawArgs: unknown,
  ctx: McpHandlerContext,
): Promise<McpToolResult> {
  const handler = HANDLERS[name];
  if (!handler) throw new McpToolError(`Unknown tool: ${name}`, 404);
  return handler(getArgs(rawArgs), ctx);
}
