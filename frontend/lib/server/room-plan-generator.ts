import { getHomeAgent, type HomeAgentDefinition } from "@/lib/home/agents";
import { getProvider, type AgentProvider, type ToolStreamEvent } from "@/lib/server/agent";
import * as dal from "./dal";
import { updateRoomPlanningContextFromStructuredPlan } from "./room-planning-context";
import type { AppRow, HomeRoomRow, PlanRow, PlanStepRiskLevel, PlanStepRow, RoomMessageRow } from "./types";

interface GeneratedPlanStep {
  title: string;
  objective_md: string;
  implementation_prompt_md: string;
  acceptance_criteria_md: string;
  risk_level?: PlanStepRiskLevel;
  requires_architecture_review?: boolean;
  requires_security_review?: boolean;
  requires_browser_validation?: boolean;
}

interface GeneratedPlan {
  title: string;
  summary_md: string;
  steps: GeneratedPlanStep[];
}

export interface GeneratedRoomPlanResult {
  plan: PlanRow;
  steps: PlanStepRow[];
  events: ToolStreamEvent[];
}

export function shouldGenerateRoomPlan(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    /\b(create|generate|draft|write|make|build|update|refresh)\b[\s\S]{0,80}\b(plan|steps?|roadmap)\b/.test(normalized) ||
    /\b(turn|convert)\b[\s\S]{0,80}\b(plan|steps?|roadmap)\b/.test(normalized) ||
    /\bplan this\b/.test(normalized)
  );
}

function buildPlanGenerationPrompt({
  app,
  room,
  userMessage,
}: {
  app: AppRow;
  room: HomeRoomRow;
  userMessage?: RoomMessageRow | null;
}): string {
  const existingPlan = dal.getPlansByRoom(room.id)[0] || null;
  const existingSteps = existingPlan ? dal.getPlanSteps(existingPlan.id) : [];
  const planningContext = room.planning_context_md?.trim();
  const recentMessages = dal.getRoomMessages(room.id, 30);

  return [
    "You are generating the structured execution plan for an Archie planning room.",
    "Inspect the repository as needed before deciding the plan.",
    "This is read-only planning. Do not edit files, install dependencies, change git state, or commit.",
    "You must generate a draft plan now. Do not ask clarifying questions instead of returning the JSON.",
    "If details are missing, make conservative assumptions and list the open questions inside summary_md or acceptance_criteria_md.",
    "",
    "Return ONLY valid JSON. Do not wrap it in markdown.",
    "JSON shape:",
    "{",
    '  "title": "Short plan title",',
    '  "summary_md": "Concise markdown summary of the plan and assumptions.",',
    '  "steps": [',
    "    {",
    '      "title": "Step title",',
    '      "objective_md": "What this step changes and why.",',
    '      "implementation_prompt_md": "The exact implementation brief to send to the task agent for this step.",',
    '      "acceptance_criteria_md": "- Observable acceptance criteria\\n- Include tests or verification expected",',
    '      "risk_level": "low|medium|high",',
    '      "requires_architecture_review": true,',
    '      "requires_security_review": false,',
    '      "requires_browser_validation": true',
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Create 2 to 8 ordered steps.",
    "- Do not return prose, analysis, XML, YAML, or markdown outside the JSON object.",
    "- Keep steps independently executable and reviewable.",
    "- Put enough context in implementation_prompt_md that a task conversation can execute only that step.",
    "- Set requires_security_review for auth, permissions, secrets, data exposure, execution, dependency, or write-path risk.",
    "- Set requires_browser_validation for visible UI or browser behavior changes.",
    "- Set requires_architecture_review for schema, routing, cross-module contracts, or sequencing risk.",
    "",
    `App: ${app.name}`,
    `Repository: ${app.directory}`,
    `Room: ${room.title}`,
    room.purpose ? `Room purpose: ${room.purpose}` : null,
    planningContext ? "Planning context summary:" : "Planning context summary: none yet",
    planningContext || null,
    "",
    existingPlan ? `Existing plan: ${existingPlan.title} (${existingPlan.status})` : "Existing plan: none",
    existingSteps.length > 0 ? "Existing steps:" : null,
    ...existingSteps.map((step) => `- ${step.position + 1}. ${step.title} (${step.status})`),
    "",
    "Recent room messages:",
    ...recentMessages.map((message) => {
      const speaker = message.role === "user"
        ? "User"
        : message.agent_key
          ? message.agent_key
          : message.role;
      return `${speaker}: ${message.body_md}`;
    }),
    userMessage ? "" : null,
    userMessage ? "Latest user request:" : null,
    userMessage ? userMessage.body_md : null,
  ].filter((line): line is string => line !== null).join("\n");
}

async function runPlanGenerator({
  provider,
  prompt,
  model,
  cwd,
}: {
  provider: AgentProvider;
  prompt: string;
  model: string;
  cwd: string;
}): Promise<{ text: string; events: ToolStreamEvent[] }> {
  const events: ToolStreamEvent[] = [];
  let text = "";

  for await (const event of provider.toolEnabledStream(prompt, {
    model,
    cwd,
    maxTurns: 8,
  })) {
    events.push(event);
    if (event.type === "result" && event.resultText) {
      text = event.resultText;
    }
    if (event.type === "error") {
      throw new Error(event.detail);
    }
  }

  return { text, events };
}

function buildJsonRepairPrompt({
  originalPrompt,
  modelOutput,
}: {
  originalPrompt: string;
  modelOutput: string;
}): string {
  return [
    "Convert the following plan-generator output into the required JSON object.",
    "Return ONLY valid JSON. Do not wrap it in markdown. Do not add commentary.",
    "If the output asks questions or is incomplete, still produce a conservative draft plan and put open questions in summary_md or acceptance_criteria_md.",
    "",
    "Required JSON shape:",
    "{",
    '  "title": "Short plan title",',
    '  "summary_md": "Concise markdown summary of the plan, assumptions, and open questions.",',
    '  "steps": [',
    "    {",
    '      "title": "Step title",',
    '      "objective_md": "What this step changes and why.",',
    '      "implementation_prompt_md": "The exact implementation brief to send to the task agent for this step.",',
    '      "acceptance_criteria_md": "- Observable acceptance criteria\\n- Include tests or verification expected",',
    '      "risk_level": "low|medium|high",',
    '      "requires_architecture_review": true,',
    '      "requires_security_review": false,',
    '      "requires_browser_validation": true',
    "    }",
    "  ]",
    "}",
    "",
    "Original instruction:",
    originalPrompt,
    "",
    "Model output to convert:",
    modelOutput || "(empty output)",
  ].join("\n");
}

async function parseOrRepairGeneratedPlan({
  provider,
  model,
  cwd,
  prompt,
  text,
  room,
}: {
  provider: AgentProvider;
  model: string;
  cwd: string;
  prompt: string;
  text: string;
  room: HomeRoomRow;
}): Promise<{ generated: GeneratedPlan; repairedText: string | null }> {
  try {
    return {
      generated: normalizeGeneratedPlan(extractJsonObject(text), room),
      repairedText: null,
    };
  } catch (initialError) {
    const repairPrompt = buildJsonRepairPrompt({
      originalPrompt: prompt,
      modelOutput: text,
    });
    const repairedText = await provider.ephemeralQuery(repairPrompt, {
      model,
      cwd,
      maxTurns: 1,
    });

    try {
      return {
        generated: normalizeGeneratedPlan(extractJsonObject(repairedText), room),
        repairedText,
      };
    } catch {
      throw initialError;
    }
  }
}

function stripOuterJsonFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const firstLineEnd = trimmed.indexOf("\n");
  if (firstLineEnd === -1) return trimmed;

  const withoutOpeningFence = trimmed.slice(firstLineEnd + 1).trim();
  return withoutOpeningFence.endsWith("```")
    ? withoutOpeningFence.slice(0, -3).trim()
    : withoutOpeningFence;
}

function findBalancedJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  if (start === -1) {
    throw new Error("Plan generator did not return JSON");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  throw new Error("Plan generator did not return JSON");
}

function extractJsonObject(text: string): unknown {
  const raw = stripOuterJsonFence(text);
  const jsonText = findBalancedJsonObject(raw);
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error("Plan generator returned invalid JSON");
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

function normalizeRiskLevel(value: unknown): PlanStepRiskLevel {
  return value === "low" || value === "high" || value === "medium" ? value : "medium";
}

function normalizeGeneratedPlan(value: unknown, room: HomeRoomRow): GeneratedPlan {
  if (!value || typeof value !== "object") {
    throw new Error("Plan generator returned an invalid object");
  }
  const record = value as Record<string, unknown>;
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  const steps = rawSteps
    .filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === "object")
    .slice(0, 8)
    .map((step, index) => ({
      title: stringValue(step.title, `Step ${index + 1}`),
      objective_md: stringValue(step.objective_md, ""),
      implementation_prompt_md: stringValue(step.implementation_prompt_md, stringValue(step.objective_md, "")),
      acceptance_criteria_md: stringValue(step.acceptance_criteria_md, ""),
      risk_level: normalizeRiskLevel(step.risk_level),
      requires_architecture_review: booleanValue(step.requires_architecture_review),
      requires_security_review: booleanValue(step.requires_security_review),
      requires_browser_validation: booleanValue(step.requires_browser_validation),
    }));

  if (steps.length === 0) {
    throw new Error("Plan generator returned no steps");
  }

  return {
    title: stringValue(record.title, `${room.title} plan`),
    summary_md: stringValue(record.summary_md, room.purpose || "Generated plan for this room."),
    steps,
  };
}

function persistGeneratedPlan(room: HomeRoomRow, generated: GeneratedPlan): { plan: PlanRow; steps: PlanStepRow[] } {
  const existing = dal.getPlansByRoom(room.id)[0] || null;
  const existingSteps = existing ? dal.getPlanSteps(existing.id) : [];
  const canReplaceExisting = existing
    ? existing.status === "draft" && existingSteps.every((step) => step.status === "pending")
    : false;

  let plan: PlanRow;
  if (existing && canReplaceExisting) {
    dal.updatePlan(existing.id, {
      title: generated.title,
      summary_md: generated.summary_md,
      status: "draft",
      current_version: existing.current_version + 1,
    });
    dal.deletePlanSteps(existing.id);
    plan = dal.getPlan(existing.id)!;
  } else {
    plan = dal.createPlan({
      room_id: room.id,
      title: generated.title,
      summary_md: generated.summary_md,
      status: "draft",
    });
  }

  const steps = generated.steps.map((step, index) => dal.createPlanStep({
    plan_id: plan.id,
    position: index,
    title: step.title,
    objective_md: step.objective_md,
    implementation_prompt_md: step.implementation_prompt_md,
    acceptance_criteria_md: step.acceptance_criteria_md,
    risk_level: step.risk_level,
    requires_architecture_review: step.requires_architecture_review,
    requires_security_review: step.requires_security_review,
    requires_browser_validation: step.requires_browser_validation,
  }));

  return { plan, steps };
}

export async function generateRoomPlanFromDiscussion({
  app,
  room,
  userMessage,
  agent = getHomeAgent("coordinator"),
}: {
  app: AppRow;
  room: HomeRoomRow;
  userMessage?: RoomMessageRow | null;
  agent?: HomeAgentDefinition;
}): Promise<GeneratedRoomPlanResult> {
  const prompt = buildPlanGenerationPrompt({ app, room, userMessage });
  const run = dal.createRoomAgentRun({
    room_id: room.id,
    agent_key: agent.key,
    provider_id: agent.defaultProvider,
    model_id: agent.defaultModel,
    phase: "planning",
    tool_policy_json: JSON.stringify({ mode: "plan_generation", tools: "read_only_codebase" }),
    input_json: JSON.stringify({ prompt }),
  });

  let generatorText = "";
  let repairedText: string | null = null;
  let events: ToolStreamEvent[] = [];

  try {
    const provider = getProvider(agent.defaultProvider);
    const result = await runPlanGenerator({
      provider,
      prompt,
      model: agent.defaultModel,
      cwd: app.directory,
    });
    generatorText = result.text;
    events = result.events;
    const parsed = await parseOrRepairGeneratedPlan({
      provider,
      prompt,
      text: result.text,
      model: agent.defaultModel,
      cwd: app.directory,
      room,
    });
    const generated = parsed.generated;
    repairedText = parsed.repairedText;
    const persisted = persistGeneratedPlan(room, generated);
    updateRoomPlanningContextFromStructuredPlan({
      roomId: room.id,
      title: generated.title,
      summaryMd: generated.summary_md,
      steps: generated.steps,
    });

    dal.updateRoomAgentRun(run.id, {
      status: "completed",
      result_json: JSON.stringify({
        text: result.text,
        repaired_text: repairedText,
        events: result.events,
        plan_id: persisted.plan.id,
        step_count: persisted.steps.length,
      }),
    });

    return { ...persisted, events: result.events };
  } catch (error) {
    dal.updateRoomAgentRun(run.id, {
      status: "failed",
      result_json: JSON.stringify({
        text: generatorText,
        repaired_text: repairedText,
        events,
      }),
      error_text: error instanceof Error ? error.message : "Unknown plan generation error",
    });
    throw error;
  }
}
