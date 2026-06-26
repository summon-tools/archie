import type { McpToolDefinition } from "./protocol";

const emptyObjectSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

const appId = {
  type: "integer",
  minimum: 1,
  description: "Archie app id.",
};

const runId = {
  type: "integer",
  minimum: 1,
  description: "Archie run id.",
};

const conversationId = {
  type: "integer",
  minimum: 1,
  description: "Archie conversation id.",
};

const taskId = {
  type: "integer",
  minimum: 1,
  description: "Archie work item id.",
};

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "archie_list_apps",
    title: "List Archie Apps",
    description: "List Archie apps visible to the MCP token.",
    inputSchema: emptyObjectSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "archie_get_app",
    title: "Get Archie App",
    description: "Get one Archie's app summary, task counts, and active process highlights.",
    inputSchema: objectSchema({ app_id: appId }, ["app_id"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "archie_list_skills",
    title: "List Archie Skills",
    description: "List enabled global skills and optional project-local skill summaries.",
    inputSchema: objectSchema({
      app_id: appId,
      scope: {
        type: "string",
        enum: ["global", "project", "all"],
        description: "Skill scope to list.",
      },
      enabled_only: {
        type: "boolean",
        description: "When true, only enabled global skills are returned.",
      },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "archie_ask_project",
    title: "Ask Archie Project",
    description: "Ask Archie to inspect an app's codebase read-only and return a synchronous answer in content[0].text and structuredContent.answer.",
    inputSchema: objectSchema({
      app_id: appId,
      question: {
        type: "string",
        minLength: 1,
        description: "Question to answer from the project codebase.",
      },
      model: { type: "string" },
      provider: { type: "string" },
    }, ["app_id", "question"]),
    outputSchema: objectSchema({
      answer: {
        type: "string",
        description: "Answer to the project question.",
      },
      app_id: appId,
      provider: { type: "string" },
      model: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
    }, ["answer", "app_id", "provider", "model"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "archie_list_tasks",
    title: "List Archie Tasks",
    description: "List recent task conversations for an app.",
    inputSchema: objectSchema({
      app_id: appId,
      status: {
        type: "string",
        enum: ["open", "archived", "running", "completed", "failed", "all"],
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
      },
    }, ["app_id"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "archie_get_task_status",
    title: "Get Archie Task Status",
    description: "Get current progress, final result, or failure information for a task run.",
    inputSchema: objectSchema({
      run_id: runId,
      conversation_id: conversationId,
      task_id: taskId,
      include_messages: { type: "boolean" },
      include_activity: { type: "boolean" },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "archie_get_task_result",
    title: "Get Archie Task Result",
    description: "Get the final result for a completed Archie task.",
    inputSchema: objectSchema({
      run_id: runId,
      conversation_id: conversationId,
      task_id: taskId,
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "archie_list_activity",
    title: "List Archie Activity",
    description: "List active runs, work items, and managed server processes.",
    inputSchema: objectSchema({
      app_id: appId,
      include_completed_since_minutes: {
        type: "integer",
        minimum: 1,
        maximum: 10080,
      },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "archie_start_task",
    title: "Start Archie Task",
    description: "Start a durable Archie implementation task. Returns a run id for polling.",
    inputSchema: objectSchema({
      app_id: appId,
      prompt: {
        type: "string",
        minLength: 1,
      },
      title: { type: "string" },
      skill_slug: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      wait_seconds: {
        type: "integer",
        minimum: 0,
        maximum: 30,
      },
    }, ["app_id", "prompt"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "archie_continue_task",
    title: "Continue Archie Task",
    description: "Send a follow-up instruction to an existing Archie task conversation.",
    inputSchema: objectSchema({
      conversation_id: conversationId,
      prompt: {
        type: "string",
        minLength: 1,
      },
      provider: { type: "string" },
      model: { type: "string" },
      wait_seconds: {
        type: "integer",
        minimum: 0,
        maximum: 30,
      },
    }, ["conversation_id", "prompt"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "archie_stop_task",
    title: "Stop Archie Task",
    description: "Stop an active Archie task conversation.",
    inputSchema: objectSchema({
      conversation_id: conversationId,
    }, ["conversation_id"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "archie_start_server",
    title: "Start Archie Server",
    description: "Start an app's main development server and return its proxy URL.",
    inputSchema: objectSchema({ app_id: appId }, ["app_id"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "archie_start_preview",
    title: "Start Archie Preview",
    description: "Start a work item preview server and return its proxy URL.",
    inputSchema: objectSchema({
      app_id: appId,
      task_id: taskId,
    }, ["app_id", "task_id"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "archie_stop_server",
    title: "Stop Archie Server",
    description: "Stop an app server or task preview server.",
    inputSchema: objectSchema({
      app_id: appId,
      task_id: taskId,
      kind: {
        type: "string",
        enum: ["app", "preview"],
      },
    }, ["app_id"]),
    annotations: { destructiveHint: true },
  },
];

export function listMcpTools(): McpToolDefinition[] {
  return MCP_TOOLS;
}

export function hasMcpTool(name: string): boolean {
  return MCP_TOOLS.some((tool) => tool.name === name);
}
