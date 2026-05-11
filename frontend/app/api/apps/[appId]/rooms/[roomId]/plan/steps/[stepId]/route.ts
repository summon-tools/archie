import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

function getStepForRoom(appId: number, roomId: number, stepId: number) {
  const app = dal.getApp(appId);
  if (!app) return { error: NextResponse.json({ detail: "App not found" }, { status: 404 }) };

  const room = dal.getRoom(roomId);
  if (!room || room.app_id !== app.id) {
    return { error: NextResponse.json({ detail: "Room not found" }, { status: 404 }) };
  }

  const step = dal.getPlanStep(stepId);
  if (!step) {
    return { error: NextResponse.json({ detail: "Plan step not found" }, { status: 404 }) };
  }

  const plan = dal.getPlan(step.plan_id);
  if (!plan || plan.room_id !== room.id) {
    return { error: NextResponse.json({ detail: "Plan step not found" }, { status: 404 }) };
  }

  return { app, room, plan, step };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string; stepId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId, stepId } = await params;
    const result = getStepForRoom(Number(appId), Number(roomId), Number(stepId));
    if (result.error) return result.error;

    const body = await request.json();
    const fields: Record<string, unknown> = {};
    for (const key of [
      "title",
      "objective_md",
      "implementation_prompt_md",
      "acceptance_criteria_md",
      "risk_level",
      "requires_architecture_review",
      "requires_security_review",
      "requires_browser_validation",
      "status",
      "linked_work_item_id",
      "linked_conversation_id",
      "commit_sha",
      "result_summary_md",
    ]) {
      if (body[key] !== undefined) fields[key] = body[key];
    }

    dal.updatePlanStep(result.step!.id, fields);
    return NextResponse.json(dal.getPlanStep(result.step!.id));
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
