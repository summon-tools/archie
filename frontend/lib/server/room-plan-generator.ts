import { getHomeAgent, type HomeAgentDefinition } from "@/lib/home/agents";
import { getProvider, type AgentProvider, type ToolStreamEvent } from "@/lib/server/agent";
import * as dal from "./dal";
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
  const recentMessages = dal.getRoomMessages(room.id, 30);

  return [
    "You are generating the structured execution plan for an Archie planning room.",
    "Inspect the repository as needed before deciding the plan.",
    "This is read-only planning. Do not edit files, install dependencies, change git state, or commit.",
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

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Plan generator did not return JSON");
  }
  return JSON.parse(raw.slice(start, end + 1));
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

  try {
    const provider = getProvider(agent.defaultProvider);
    const result = await runPlanGenerator({
      provider,
      prompt,
      model: agent.defaultModel,
      cwd: app.directory,
    });
    const generated = normalizeGeneratedPlan(extractJsonObject(result.text), room);
    const persisted = persistGeneratedPlan(room, generated);

    dal.updateRoomAgentRun(run.id, {
      status: "completed",
      result_json: JSON.stringify({
        text: result.text,
        events: result.events,
        plan_id: persisted.plan.id,
        step_count: persisted.steps.length,
      }),
    });

    return { ...persisted, events: result.events };
  } catch (error) {
    dal.updateRoomAgentRun(run.id, {
      status: "failed",
      error_text: error instanceof Error ? error.message : "Unknown plan generation error",
    });
    throw error;
  }
}
