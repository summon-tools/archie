import { getDb } from "./db";
import { getProvider, type ToolStreamEvent } from "./agent";
import * as dal from "./dal";
import { getHomeAgent, type HomeAgentDefinition } from "@/lib/home/agents";
import { enrichWorkItem } from "./work-item-view";
import { emitConversationEvent } from "./conversation-events";
import { runGitSafe } from "./worktrees";
import type { AppRow, ConversationRow, HomeRoomRow, PlanRow, PlanStepEventRow, PlanStepRow, PlanStepStatus, WorkItemRow } from "./types";

const ACTIVE_STEP_STATUSES = new Set(["implementing", "reviewing", "fixing", "validating", "committing"]);
const GATE_PHASES = new Set(["architecture_review", "code_review", "security_review", "qa_validation", "browser_validation", "commit"]);
const AUTOMATED_GATE_STATUSES = new Set(["pending", "running"]);

type GateDefinition = {
  phase: string;
  agentKey: string;
  summary: string;
};

type GateDecision = {
  status: "passed" | "failed";
  summary_md: string;
  feedback_md: string;
  commitSha?: string | null;
};

type AutomatedGateResult = {
  plan: PlanRow;
  step: PlanStepRow;
  events: PlanStepEventRow[];
};

export class PlanExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function buildPlanStepImplementationPrompt({
  app,
  room,
  plan,
  step,
}: {
  app: AppRow;
  room: HomeRoomRow;
  plan: PlanRow;
  step: PlanStepRow;
}): string {
  const sections: string[] = [
    "# Plan step implementation brief",
    "",
    `App: ${app.name}`,
    `Room: ${room.title}`,
    `Plan: ${plan.title}`,
    `Step ${step.position + 1}: ${step.title}`,
    "",
    "## Objective",
    step.objective_md.trim() || "No objective provided.",
    "",
    "## Implementation Scope",
    (step.implementation_prompt_md || step.objective_md).trim() || "Use the step title and objective as the implementation brief.",
  ];

  if (step.acceptance_criteria_md.trim()) {
    sections.push("", "## Acceptance Criteria", step.acceptance_criteria_md.trim());
  }

  const gates = [
    step.requires_architecture_review ? "Architecture review is required after implementation." : null,
    step.requires_security_review ? "Security review is required after implementation." : null,
    step.requires_browser_validation ? "Browser validation is required after implementation." : null,
  ].filter(Boolean);

  sections.push(
    "",
    "## Execution Rules",
    "- Work only on this plan step. Do not implement later plan steps unless this step explicitly depends on them.",
    "- Keep the existing normal task conversation and worktree flow intact.",
    "- Add or update focused tests for this step and run the relevant validation.",
    "- Stop after this step is ready for the deterministic review gates.",
  );

  if (gates.length > 0) {
    sections.push("", "## Required Gates", ...gates.map((gate) => `- ${gate}`));
  }

  return sections.join("\n");
}

export function launchNextPlanStep({
  appId,
  roomId,
  userId,
}: {
  appId: number;
  roomId: number;
  userId: number | null;
}): {
  plan: PlanRow;
  step: PlanStepRow;
  conversation: ConversationRow;
  workItem: WorkItemRow & Record<string, unknown>;
} {
  const app = dal.getApp(appId);
  if (!app) throw new PlanExecutionError("app_not_found", "App not found", 404);

  const room = dal.getRoom(roomId);
  if (!room || room.app_id !== app.id) {
    throw new PlanExecutionError("room_not_found", "Room not found", 404);
  }

  const plan = dal.getPlansByRoom(room.id)[0];
  if (!plan) throw new PlanExecutionError("plan_not_found", "Plan not found", 404);
  if (plan.status === "draft") {
    throw new PlanExecutionError("plan_not_ready", "Plan must be marked ready before execution", 409);
  }
  if (["completed", "cancelled", "blocked"].includes(plan.status)) {
    throw new PlanExecutionError("plan_not_executable", `Plan is ${plan.status}`, 409);
  }

  const steps = dal.getPlanSteps(plan.id);
  const activeStep = steps.find((step) => ACTIVE_STEP_STATUSES.has(step.status));
  if (activeStep) {
    throw new PlanExecutionError("step_already_active", "A plan step is already active", 409);
  }

  const nextStep = steps.find((step) => step.status === "pending");
  if (!nextStep) {
    throw new PlanExecutionError("no_pending_step", "No pending plan step to execute", 409);
  }

  const prompt = buildPlanStepImplementationPrompt({ app, room, plan, step: nextStep });
  const existingExecutionTarget = getExistingExecutionTarget(steps);
  const db = getDb();

  const result = db.transaction(() => {
    const conversation = existingExecutionTarget?.conversation || dal.createConversation({
      app_id: app.id,
      kind: "task",
      title: plan.title,
      created_by: userId,
      origin_type: "room_plan",
      origin_automation_key: `room:${room.id}:plan:${plan.id}`,
    });

    const workItem = existingExecutionTarget?.workItem || dal.createWorkItem({
      app_id: app.id,
      primary_conversation_id: conversation.id,
      title: plan.title,
      summary: prompt,
      kind: "task",
      created_by: userId,
      origin_type: "room_plan",
      origin_automation_key: `room:${room.id}:plan:${plan.id}`,
    });

    dal.createMessage({
      conversation_id: conversation.id,
      role: "user",
      author_user_id: userId,
      body_md: prompt,
    });

    if (plan.status === "ready") {
      dal.updatePlan(plan.id, { status: "executing" });
    }

    dal.updatePlanStep(nextStep.id, {
      status: "implementing",
      linked_work_item_id: workItem.id,
      linked_conversation_id: conversation.id,
    });

    dal.createPlanStepEvent({
      plan_step_id: nextStep.id,
      phase: "implementation",
      agent_key: "coordinator",
      status: "started",
      summary_md: existingExecutionTarget
        ? `Queued implementation step "${nextStep.title}" in the existing execution conversation.`
        : `Started implementation conversation for "${nextStep.title}".`,
      payload_json: JSON.stringify({
        work_item_id: workItem.id,
        conversation_id: conversation.id,
        reused_execution_conversation: Boolean(existingExecutionTarget),
      }),
    });

    dal.createRoomMessage({
      room_id: room.id,
      role: "system",
      kind: "execution_event",
      body_md: existingExecutionTarget
        ? `Queued step ${nextStep.position + 1} in the existing implementation task: ${nextStep.title}`
        : `Started implementation for step ${nextStep.position + 1}: ${nextStep.title}`,
      payload_json: JSON.stringify({
        plan_id: plan.id,
        plan_step_id: nextStep.id,
        work_item_id: workItem.id,
        conversation_id: conversation.id,
        reused_execution_conversation: Boolean(existingExecutionTarget),
      }),
    });

    return {
      conversation,
      workItem,
      plan: dal.getPlan(plan.id)!,
      step: dal.getPlanStep(nextStep.id)!,
    };
  })();

  return {
    ...result,
    workItem: enrichWorkItem(result.workItem),
  };
}

function getStepContext(appId: number, roomId: number, stepId: number): {
  app: AppRow;
  room: HomeRoomRow;
  plan: PlanRow;
  step: PlanStepRow;
} {
  const app = dal.getApp(appId);
  if (!app) throw new PlanExecutionError("app_not_found", "App not found", 404);

  const room = dal.getRoom(roomId);
  if (!room || room.app_id !== app.id) {
    throw new PlanExecutionError("room_not_found", "Room not found", 404);
  }

  const step = dal.getPlanStep(stepId);
  if (!step) throw new PlanExecutionError("step_not_found", "Plan step not found", 404);

  const plan = dal.getPlan(step.plan_id);
  if (!plan || plan.room_id !== room.id) {
    throw new PlanExecutionError("step_not_found", "Plan step not found", 404);
  }

  return { app, room, plan, step };
}

function buildGateSequence(step: PlanStepRow): GateDefinition[] {
  return [
    step.requires_architecture_review ? {
      phase: "architecture_review",
      agentKey: "architect",
      summary: "Architecture review",
    } : null,
    {
      phase: "code_review",
      agentKey: "reviewer",
      summary: "Code review",
    },
    step.requires_security_review ? {
      phase: "security_review",
      agentKey: "security",
      summary: "Security review",
    } : null,
    {
      phase: "qa_validation",
      agentKey: "qa",
      summary: "QA validation",
    },
    step.requires_browser_validation ? {
      phase: "browser_validation",
      agentKey: "qa",
      summary: "Browser validation",
    } : null,
    {
      phase: "commit",
      agentKey: "coordinator",
      summary: "Commit checkpoint",
    },
  ].filter(Boolean) as GateDefinition[];
}

function statusForGatePhase(phase: string | null): PlanStepStatus {
  if (phase === "qa_validation" || phase === "browser_validation") return "validating";
  if (phase === "commit") return "committing";
  return "reviewing";
}

function getPendingGate(events: PlanStepEventRow[]): PlanStepEventRow | undefined {
  return events.find((event) => GATE_PHASES.has(event.phase) && AUTOMATED_GATE_STATUSES.has(event.status));
}

function getAutomatedGate(events: PlanStepEventRow[]): PlanStepEventRow | undefined {
  return events.find((event) => GATE_PHASES.has(event.phase) && AUTOMATED_GATE_STATUSES.has(event.status));
}

function getGateForAdvancement(events: PlanStepEventRow[], gateEventId?: number): PlanStepEventRow | undefined {
  if (!gateEventId) return getPendingGate(events);
  return events.find((event) => (
    event.id === gateEventId &&
    GATE_PHASES.has(event.phase) &&
    AUTOMATED_GATE_STATUSES.has(event.status)
  ));
}

function getExistingExecutionTarget(steps: PlanStepRow[]): {
  conversation: ConversationRow;
  workItem: WorkItemRow;
} | null {
  for (const step of steps) {
    if (!step.linked_conversation_id || !step.linked_work_item_id) continue;
    const conversation = dal.getConversation(step.linked_conversation_id);
    const workItem = dal.getWorkItem(step.linked_work_item_id);
    if (conversation && workItem) {
      return { conversation, workItem };
    }
  }

  return null;
}

function syncPlanCompletion(planId: number): PlanRow {
  const steps = dal.getPlanSteps(planId);
  if (steps.length > 0 && steps.every((step) => step.status === "completed" || step.status === "skipped")) {
    dal.updatePlan(planId, { status: "completed" });
  }
  return dal.getPlan(planId)!;
}

export function startPlanStepGates({
  appId,
  roomId,
  stepId,
}: {
  appId: number;
  roomId: number;
  stepId: number;
}): {
  plan: PlanRow;
  step: PlanStepRow;
  events: PlanStepEventRow[];
} {
  const { room, plan, step } = getStepContext(appId, roomId, stepId);
  if (!["implementing", "fixing"].includes(step.status)) {
    throw new PlanExecutionError("step_not_ready_for_gates", "Step must be implementing or fixing before gates can start", 409);
  }

  const existingEvents = dal.getPlanStepEvents(step.id);
  if (getPendingGate(existingEvents)) {
    throw new PlanExecutionError("gate_already_pending", "A review gate is already pending", 409);
  }

  const sequence = buildGateSequence(step);
  if (sequence.length === 0) {
    throw new PlanExecutionError("no_gates", "No gates are configured for this step", 409);
  }

  const result = getDb().transaction(() => {
    for (const event of existingEvents.filter((candidate) => candidate.phase === "implementation" && candidate.status === "started")) {
      dal.updatePlanStepEvent(event.id, { status: "completed" });
    }

    for (const gate of sequence) {
      dal.createPlanStepEvent({
        plan_step_id: step.id,
        phase: gate.phase,
        agent_key: gate.agentKey,
        status: "pending",
        summary_md: gate.summary,
      });
    }

    dal.updatePlanStep(step.id, { status: statusForGatePhase(sequence[0]?.phase || null) });
    dal.createRoomMessage({
      room_id: room.id,
      role: "system",
      kind: "execution_event",
      body_md: `Started review gates for step ${step.position + 1}: ${step.title}`,
      payload_json: JSON.stringify({ plan_id: plan.id, plan_step_id: step.id }),
    });

    return {
      plan: dal.getPlan(plan.id)!,
      step: dal.getPlanStep(step.id)!,
      events: dal.getPlanStepEvents(step.id),
    };
  })();

  return result;
}

export function startPlanStepGatesForCompletedConversation({
  appId,
  conversationId,
}: {
  appId: number;
  conversationId: number;
}): {
  plan: PlanRow;
  step: PlanStepRow;
  events: PlanStepEventRow[];
} | null {
  const step = dal.getActivePlanStepByConversation(conversationId);
  if (!step) return null;

  const plan = dal.getPlan(step.plan_id);
  if (!plan) return null;

  const room = dal.getRoom(plan.room_id);
  if (!room || room.app_id !== appId) return null;

  try {
    return startPlanStepGates({ appId, roomId: room.id, stepId: step.id });
  } catch (error) {
    if (error instanceof PlanExecutionError && error.code === "gate_already_pending") {
      return {
        plan,
        step,
        events: dal.getPlanStepEvents(step.id),
      };
    }
    throw error;
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
    throw new Error("Gate agent did not return JSON");
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

  throw new Error("Gate agent did not return JSON");
}

function parseGateDecision(rawText: string, fallbackSummary: string): GateDecision {
  const jsonText = findBalancedJsonObject(stripOuterJsonFence(rawText));
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const rawStatus = parsed.status;
  const status = rawStatus === "failed" ? "failed" : "passed";
  const summary = typeof parsed.summary_md === "string" && parsed.summary_md.trim()
    ? parsed.summary_md.trim()
    : fallbackSummary;
  const feedback = typeof parsed.feedback_md === "string" && parsed.feedback_md.trim()
    ? parsed.feedback_md.trim()
    : summary;

  return {
    status,
    summary_md: summary,
    feedback_md: feedback,
  };
}

function getWorktreeDirectory(app: AppRow, step: PlanStepRow): string {
  if (step.linked_work_item_id) {
    const env = dal.getWorkItemEnv(step.linked_work_item_id);
    if (env?.worktree_dir) return env.worktree_dir;
  }
  return app.directory;
}

function getDiffContext(directory: string): string {
  const status = runGitSafe(directory, ["status", "--porcelain"], 10_000);
  const stat = runGitSafe(directory, ["diff", "--stat", "--no-color"], 10_000);
  const diff = runGitSafe(directory, ["diff", "--no-color"], 20_000);
  const stagedStat = runGitSafe(directory, ["diff", "--cached", "--stat", "--no-color"], 10_000);
  const stagedDiff = runGitSafe(directory, ["diff", "--cached", "--no-color"], 20_000);

  return [
    "## Git status",
    status.stdout.trim() || "Clean",
    "",
    "## Unstaged diff stat",
    stat.stdout.trim() || "None",
    "",
    "## Staged diff stat",
    stagedStat.stdout.trim() || "None",
    "",
    "## Unstaged diff",
    diff.stdout.trim() || "None",
    "",
    "## Staged diff",
    stagedDiff.stdout.trim() || "None",
  ].join("\n").slice(0, 45_000);
}

function gateInstructions(phase: string): string {
  switch (phase) {
    case "architecture_review":
      return "Review architecture, data flow, ordering, coupling, migration safety, and whether this step fits the plan without pulling in later work.";
    case "security_review":
      return "Review auth, authorization, data exposure, secret handling, dependency risk, unsafe execution, file/system access, and permission boundaries.";
    case "qa_validation":
      return "Review acceptance criteria, test coverage, likely regressions, edge cases, and whether the validation performed is enough for this step.";
    case "browser_validation":
      return "Review whether the browser-facing behavior can be validated from the current changes and call out any missing browser checks.";
    default:
      return "Review the changed code for correctness, regressions, missing tests, maintainability, and whether the implementation satisfies this step only.";
  }
}

function buildGatePrompt({
  app,
  room,
  plan,
  step,
  gate,
  agent,
  directory,
}: {
  app: AppRow;
  room: HomeRoomRow;
  plan: PlanRow;
  step: PlanStepRow;
  gate: PlanStepEventRow;
  agent: HomeAgentDefinition;
  directory: string;
}): string {
  const messages = step.linked_conversation_id
    ? dal.getConversationMessages(step.linked_conversation_id, 12)
    : [];
  const conversationContext = messages.map((message) => {
    const speaker = message.role === "assistant" ? "Implementer" : "User";
    return `${speaker}: ${message.body_md}`;
  }).join("\n\n");

  return [
    `You are the ${agent.name} agent running an automated execution gate in Archie.`,
    `Role: ${agent.role}`,
    "",
    "This is a read-only gate. You may inspect the repository and run read-only or validation commands, but do not edit files, install dependencies, change git state, commit, or push.",
    "",
    `App: ${app.name}`,
    `Repository/worktree: ${directory}`,
    `Room: ${room.title}`,
    `Plan: ${plan.title}`,
    `Step ${step.position + 1}: ${step.title}`,
    "",
    "## Step Objective",
    step.objective_md.trim() || "No objective provided.",
    "",
    "## Implementation Scope",
    (step.implementation_prompt_md || step.objective_md).trim() || "Use the step title and objective as the implementation brief.",
    "",
    "## Acceptance Criteria",
    step.acceptance_criteria_md.trim() || "No acceptance criteria provided.",
    "",
    "## Gate",
    gate.summary_md || gate.phase,
    gateInstructions(gate.phase),
    "",
    "## Recent implementation conversation",
    conversationContext || "No implementation conversation messages were recorded.",
    "",
    "## Current diff context",
    getDiffContext(directory),
    "",
    "Return only a JSON object with this shape:",
    "{",
    '  "status": "passed" | "failed",',
    '  "summary_md": "Short markdown summary of the gate result.",',
    '  "feedback_md": "Concrete feedback. If failed, include the exact fixes the implementer must make."',
    "}",
    "",
    "Pass only when this gate has no blocking concerns. If there is a blocking bug, missing required validation, or unclear implementation state, return failed.",
  ].join("\n");
}

async function runAgentGate({
  app,
  room,
  plan,
  step,
  gate,
}: {
  app: AppRow;
  room: HomeRoomRow;
  plan: PlanRow;
  step: PlanStepRow;
  gate: PlanStepEventRow;
}): Promise<GateDecision> {
  const agent = getHomeAgent((gate.agent_key || "reviewer") as Parameters<typeof getHomeAgent>[0]);
  const directory = getWorktreeDirectory(app, step);
  const prompt = buildGatePrompt({ app, room, plan, step, gate, agent, directory });
  const provider = getProvider(agent.defaultProvider);
  const events: ToolStreamEvent[] = [];
  let resultText = "";

  const run = dal.createRoomAgentRun({
    room_id: room.id,
    agent_key: agent.key,
    provider_id: agent.defaultProvider,
    model_id: agent.defaultModel,
    phase: agent.key === "security" ? "security" : agent.key === "qa" ? "qa" : "review",
    tool_policy_json: JSON.stringify({ mode: "execution_gate", gate_phase: gate.phase, tools: "read_only_codebase" }),
    input_json: JSON.stringify({ prompt, plan_step_event_id: gate.id }),
  });

  try {
    for await (const event of provider.toolEnabledStream(prompt, {
      model: agent.defaultModel,
      cwd: directory,
      maxTurns: 8,
    })) {
      events.push(event);
      if (event.type === "result" && event.resultText) {
        resultText = event.resultText;
      }
      if (event.type === "error") {
        throw new Error(event.detail);
      }
    }

    const decision = parseGateDecision(resultText, `${agent.name} gate completed.`);
    dal.updateRoomAgentRun(run.id, {
      status: "completed",
      result_json: JSON.stringify({ decision, events }),
    });
    return decision;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gate agent error";
    dal.updateRoomAgentRun(run.id, {
      status: "failed",
      error_text: message,
      result_json: JSON.stringify({ events, raw_result: resultText }),
    });
    return {
      status: "failed",
      summary_md: `${agent.name} gate could not complete.`,
      feedback_md: `The ${agent.name} gate failed to produce a usable result: ${message}`,
    };
  }
}

function buildCommitMessage(step: PlanStepRow): string {
  const normalized = step.title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toLowerCase());
  return `chore: ${normalized || "complete plan step"}`;
}

function buildApprovalReadyMessage({
  plan,
  step,
}: {
  plan: PlanRow;
  step: PlanStepRow;
}): string {
  const workItem = step.linked_work_item_id ? dal.getWorkItem(step.linked_work_item_id) : null;
  const env = step.linked_work_item_id ? dal.getWorkItemEnv(step.linked_work_item_id) : null;
  const branchLine = env?.branch_name ? `\n\nBranch: \`${env.branch_name}\`` : "";
  const taskLine = workItem ? `\nTask: ${workItem.title}` : "";

  return [
    `The plan **${plan.title}** is complete and ready for your approval.`,
    "",
    "All implementation steps and review gates have finished. The task is still open so you can review the result, request changes, or approve it for PR/merge.",
    taskLine.trim(),
    branchLine.trim(),
  ].filter(Boolean).join("\n");
}

function notifyPlanReadyForApproval({
  room,
  plan,
  step,
}: {
  room: HomeRoomRow;
  plan: PlanRow;
  step: PlanStepRow;
}): void {
  const message = buildApprovalReadyMessage({ plan, step });
  dal.createRoomMessage({
    room_id: room.id,
    role: "system",
    kind: "execution_event",
    body_md: message,
    payload_json: JSON.stringify({
      plan_id: plan.id,
      plan_step_id: step.id,
      ready_for_approval: true,
    }),
  });

  if (!step.linked_conversation_id) return;

  const assistantMessage = dal.createMessage({
    conversation_id: step.linked_conversation_id,
    role: "assistant",
    kind: "text",
    body_md: message,
  });
  emitConversationEvent(step.linked_conversation_id, {
    type: "message",
    message: {
      id: assistantMessage.id,
      conversation_id: step.linked_conversation_id,
      role: "assistant",
      content: message,
      message_type: "text",
      created_by_name: null,
      created_by_color: null,
      created_at: assistantMessage.created_at,
    },
  });
}

function runCommitGate(app: AppRow, step: PlanStepRow): GateDecision & { commitSha?: string | null } {
  const directory = getWorktreeDirectory(app, step);
  const status = runGitSafe(directory, ["status", "--porcelain"], 10_000);
  if (status.returncode !== 0) {
    return {
      status: "failed",
      summary_md: "Commit gate could not inspect git status.",
      feedback_md: status.stdout || "Git status failed.",
    };
  }

  if (!status.stdout.trim()) {
    const head = runGitSafe(directory, ["rev-parse", "--short", "HEAD"], 10_000);
    return {
      status: "passed",
      summary_md: "No uncommitted changes remained for this step.",
      feedback_md: "The worktree was already clean.",
      commitSha: head.returncode === 0 ? head.stdout.trim() : null,
    };
  }

  const add = runGitSafe(directory, ["add", "-A"], 30_000);
  if (add.returncode !== 0) {
    return {
      status: "failed",
      summary_md: "Commit gate could not stage changes.",
      feedback_md: add.stdout || "Git add failed.",
    };
  }

  const commitMessage = buildCommitMessage(step);
  const commit = runGitSafe(directory, ["commit", "-m", commitMessage], 60_000);
  if (commit.returncode !== 0 && !commit.stdout.includes("nothing to commit")) {
    return {
      status: "failed",
      summary_md: "Commit gate could not create a commit.",
      feedback_md: commit.stdout || "Git commit failed.",
    };
  }

  const head = runGitSafe(directory, ["rev-parse", "--short", "HEAD"], 10_000);
  const commitSha = head.returncode === 0 ? head.stdout.trim() : null;
  return {
    status: "passed",
    summary_md: commitSha
      ? `Committed this step as ${commitSha}.`
      : "Committed this step.",
    feedback_md: `Created commit with message: \`${commitMessage}\`.`,
    commitSha,
  };
}

async function drainConversationStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

function buildFixPrompt({
  step,
  gate,
  decision,
}: {
  step: PlanStepRow;
  gate: PlanStepEventRow;
  decision: GateDecision;
}): string {
  return [
    "# Plan gate feedback",
    "",
    `Step ${step.position + 1}: ${step.title}`,
    `Gate: ${gate.summary_md || gate.phase}`,
    "",
    "The gate requested fixes before this plan step can advance.",
    "",
    "## Feedback",
    decision.feedback_md || decision.summary_md,
    "",
    "## Instructions",
    "- Fix only the issues needed for this current plan step.",
    "- Do not start later plan steps.",
    "- Update or add focused validation if the feedback asks for it.",
    "- Stop when the step is ready for the review gates to run again.",
  ].join("\n");
}

async function sendFixPromptToImplementation({
  app,
  step,
  gate,
  decision,
}: {
  app: AppRow;
  step: PlanStepRow;
  gate: PlanStepEventRow;
  decision: GateDecision;
}): Promise<void> {
  if (!step.linked_conversation_id) return;
  const { streamConversationMessage } = await import("./conversation");
  const stream = await streamConversationMessage(
    step.linked_conversation_id,
    buildFixPrompt({ step, gate, decision }),
    app.name,
    app.directory,
  );
  await drainConversationStream(stream);
}

async function runImplementationConversation({
  app,
  room,
  plan,
  step,
}: {
  app: AppRow;
  room: HomeRoomRow;
  plan: PlanRow;
  step: PlanStepRow;
}): Promise<void> {
  if (!step.linked_conversation_id) return;
  const { streamConversationMessage } = await import("./conversation");
  const prompt = buildPlanStepImplementationPrompt({ app, room, plan, step });
  const stream = await streamConversationMessage(
    step.linked_conversation_id,
    prompt,
    app.name,
    app.directory,
    undefined,
    undefined,
    true,
  );
  await drainConversationStream(stream);
}

async function launchAndRunNextStep({
  appId,
  roomId,
}: {
  appId: number;
  roomId: number;
}): Promise<void> {
  try {
    const launched = launchNextPlanStep({ appId, roomId, userId: null });
    const app = dal.getApp(appId);
    const room = dal.getRoom(roomId);
    if (!app || !room) return;

    await runImplementationConversation({
      app,
      room,
      plan: launched.plan,
      step: launched.step,
    });
  } catch (error) {
    if (error instanceof PlanExecutionError && error.code === "no_pending_step") return;
    throw error;
  }
}

const gateRunState = globalThis as typeof globalThis & {
  __archiePlanGateRuns?: Set<number>;
};
const activeGateRuns = gateRunState.__archiePlanGateRuns ??= new Set<number>();

export function scheduleAutomatedPlanStepGates({
  appId,
  roomId,
  stepId,
  delayMs = 250,
}: {
  appId: number;
  roomId: number;
  stepId: number;
  delayMs?: number;
}): void {
  setTimeout(() => {
    void runAutomatedPlanStepGates({ appId, roomId, stepId });
  }, delayMs);
}

export async function runAutomatedPlanStepGates({
  appId,
  roomId,
  stepId,
}: {
  appId: number;
  roomId: number;
  stepId: number;
}): Promise<AutomatedGateResult | null> {
  if (activeGateRuns.has(stepId)) {
    const step = dal.getPlanStep(stepId);
    if (!step) return null;
    const plan = dal.getPlan(step.plan_id);
    if (!plan) return null;
    return { plan, step, events: dal.getPlanStepEvents(step.id) };
  }

  activeGateRuns.add(stepId);

  try {
    while (true) {
      const { app, room, plan, step } = getStepContext(appId, roomId, stepId);
      const events = dal.getPlanStepEvents(step.id);
      const gate = getAutomatedGate(events);
      if (!gate) {
        if (step.status === "completed" && plan.status === "executing") {
          const hasPendingStep = dal.getPlanSteps(plan.id).some((candidate) => candidate.status === "pending");
          if (hasPendingStep) {
            await launchAndRunNextStep({ appId, roomId });
          }
        }
        return { plan, step, events };
      }

      dal.updatePlanStepEvent(gate.id, { status: "running" });
      dal.createRoomMessage({
        room_id: room.id,
        role: "system",
        kind: "execution_event",
        body_md: `${gate.summary_md || gate.phase} started for step ${step.position + 1}: ${step.title}`,
        payload_json: JSON.stringify({ plan_id: plan.id, plan_step_id: step.id, gate_event_id: gate.id }),
      });

      const decision = gate.phase === "commit"
        ? runCommitGate(app, step)
        : await runAgentGate({ app, room, plan, step, gate });

      let updated: AutomatedGateResult;
      try {
        updated = advancePlanStepGate({
          appId,
          roomId,
          stepId,
          gateEventId: gate.id,
          outcome: decision.status,
          summary: decision.status === "passed" ? decision.summary_md : decision.feedback_md,
          commitSha: decision.commitSha ?? null,
        });
      } catch (error) {
        if (error instanceof PlanExecutionError && error.code === "no_pending_gate") {
          const staleStep = dal.getPlanStep(stepId);
          const stalePlan = staleStep ? dal.getPlan(staleStep.plan_id) : null;
          if (!staleStep || !stalePlan) return null;
          return {
            plan: stalePlan,
            step: staleStep,
            events: dal.getPlanStepEvents(staleStep.id),
          };
        }
        throw error;
      }

      if (decision.status === "failed") {
        await sendFixPromptToImplementation({ app, step, gate, decision });
        return updated;
      }

      if (gate.phase === "commit") {
        if (updated.plan.status === "completed") {
          notifyPlanReadyForApproval({ room, plan: updated.plan, step: updated.step });
          return updated;
        }

        await launchAndRunNextStep({ appId, roomId });
        return updated;
      }
    }
  } finally {
    activeGateRuns.delete(stepId);
  }
}

export function advancePlanStepGate({
  appId,
  roomId,
  stepId,
  gateEventId,
  outcome = "passed",
  summary,
  commitSha,
}: {
  appId: number;
  roomId: number;
  stepId: number;
  gateEventId?: number;
  outcome?: "passed" | "failed";
  summary?: string;
  commitSha?: string | null;
}): {
  plan: PlanRow;
  step: PlanStepRow;
  events: PlanStepEventRow[];
} {
  const { room, plan, step } = getStepContext(appId, roomId, stepId);
  const events = dal.getPlanStepEvents(step.id);
  const currentGate = getGateForAdvancement(events, gateEventId);
  if (!currentGate) {
    throw new PlanExecutionError("no_pending_gate", "No pending review gate to advance", 409);
  }

  const result = getDb().transaction(() => {
    if (outcome === "failed") {
      dal.updatePlanStepEvent(currentGate.id, {
        status: "failed",
        summary_md: summary || currentGate.summary_md,
      });

      for (const event of events.filter((candidate) => GATE_PHASES.has(candidate.phase) && candidate.status === "pending" && candidate.id !== currentGate.id)) {
        dal.updatePlanStepEvent(event.id, { status: "skipped" });
      }

      dal.updatePlanStep(step.id, {
        status: "fixing",
        result_summary_md: summary || `${currentGate.summary_md || currentGate.phase} requested fixes.`,
      });
      dal.createRoomMessage({
        room_id: room.id,
        role: "system",
        kind: "execution_event",
        body_md: `${currentGate.summary_md || currentGate.phase} requested fixes for step ${step.position + 1}: ${step.title}`,
        payload_json: JSON.stringify({ plan_id: plan.id, plan_step_id: step.id, gate_event_id: currentGate.id }),
      });

      return {
        plan: dal.getPlan(plan.id)!,
        step: dal.getPlanStep(step.id)!,
        events: dal.getPlanStepEvents(step.id),
      };
    }

    const payload = currentGate.phase === "commit" && commitSha
      ? JSON.stringify({ commit_sha: commitSha })
      : currentGate.payload_json;
    dal.updatePlanStepEvent(currentGate.id, {
      status: "completed",
      summary_md: summary || currentGate.summary_md,
      payload_json: payload,
    });

    const freshEvents = dal.getPlanStepEvents(step.id);
    const nextGate = getPendingGate(freshEvents);
    if (nextGate) {
      dal.updatePlanStep(step.id, { status: statusForGatePhase(nextGate.phase) });
    } else {
      dal.updatePlanStep(step.id, {
        status: "completed",
        commit_sha: currentGate.phase === "commit" && commitSha ? commitSha : step.commit_sha,
        result_summary_md: summary || step.result_summary_md,
      });
    }

    dal.createRoomMessage({
      room_id: room.id,
      role: "system",
      kind: "execution_event",
      body_md: `${currentGate.summary_md || currentGate.phase} passed for step ${step.position + 1}: ${step.title}`,
      payload_json: JSON.stringify({ plan_id: plan.id, plan_step_id: step.id, gate_event_id: currentGate.id }),
    });

    const updatedPlan = syncPlanCompletion(plan.id);
    return {
      plan: updatedPlan,
      step: dal.getPlanStep(step.id)!,
      events: dal.getPlanStepEvents(step.id),
    };
  })();

  return result;
}
