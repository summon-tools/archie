import { getDb } from "./db";
import * as dal from "./dal";
import { enrichWorkItem } from "./work-item-view";
import type { AppRow, ConversationRow, HomeRoomRow, PlanRow, PlanStepRow, WorkItemRow } from "./types";

const ACTIVE_STEP_STATUSES = new Set(["implementing", "reviewing", "fixing", "validating", "committing"]);

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
  const db = getDb();

  const result = db.transaction(() => {
    const conversation = dal.createConversation({
      app_id: app.id,
      kind: "task",
      title: nextStep.title,
      created_by: userId,
      origin_type: "room_plan",
      origin_automation_key: `room:${room.id}:plan:${plan.id}:step:${nextStep.id}`,
    });

    const workItem = dal.createWorkItem({
      app_id: app.id,
      primary_conversation_id: conversation.id,
      title: nextStep.title,
      summary: prompt,
      kind: "task",
      created_by: userId,
      origin_type: "room_plan",
      origin_automation_key: `room:${room.id}:plan:${plan.id}:step:${nextStep.id}`,
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
      summary_md: `Started implementation conversation for "${nextStep.title}".`,
      payload_json: JSON.stringify({
        work_item_id: workItem.id,
        conversation_id: conversation.id,
      }),
    });

    dal.createRoomMessage({
      room_id: room.id,
      role: "system",
      kind: "execution_event",
      body_md: `Started implementation for step ${nextStep.position + 1}: ${nextStep.title}`,
      payload_json: JSON.stringify({
        plan_id: plan.id,
        plan_step_id: nextStep.id,
        work_item_id: workItem.id,
        conversation_id: conversation.id,
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
