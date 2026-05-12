import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { getPlanExecutionElapsedMs, pausePlanExecution, PlanExecutionError } from "@/lib/server/plan-execution";
import * as dal from "@/lib/server/dal";

function serializePlan(roomId: number) {
  const room = dal.getRoom(roomId);
  const plan = dal.getPlansByRoom(roomId)[0] || null;
  const steps = plan ? dal.getPlanSteps(plan.id).map((step) => ({
    ...step,
    events: dal.getPlanStepEvents(step.id),
  })) : [];

  return {
    plan: plan ? {
      ...plan,
      execution_elapsed_ms: getPlanExecutionElapsedMs(plan),
    } : null,
    steps,
    planning_context_md: room?.planning_context_md || "",
    planning_context_updated_at: room?.planning_context_updated_at || null,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId } = await params;
    pausePlanExecution({ appId: Number(appId), roomId: Number(roomId) });
    return NextResponse.json(serializePlan(Number(roomId)));
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof PlanExecutionError) {
      return NextResponse.json({ detail: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
