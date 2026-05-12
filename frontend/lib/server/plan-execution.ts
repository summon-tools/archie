import { getDb } from "./db";
import * as dal from "./dal";
import { enrichWorkItem } from "./work-item-view";
import type { AppRow, ConversationRow, HomeRoomRow, PlanRow, PlanStepEventRow, PlanStepRow, PlanStepStatus, WorkItemRow } from "./types";

const ACTIVE_STEP_STATUSES = new Set(["implementing", "reviewing", "fixing", "validating", "committing"]);
const GATE_PHASES = new Set(["architecture_review", "code_review", "security_review", "qa_validation", "browser_validation", "commit"]);

type GateDefinition = {
  phase: string;
  agentKey: string;
  summary: string;
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
  return events.find((event) => GATE_PHASES.has(event.phase) && event.status === "pending");
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

export function advancePlanStepGate({
  appId,
  roomId,
  stepId,
  outcome = "passed",
  summary,
  commitSha,
}: {
  appId: number;
  roomId: number;
  stepId: number;
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
  const currentGate = getPendingGate(events);
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
