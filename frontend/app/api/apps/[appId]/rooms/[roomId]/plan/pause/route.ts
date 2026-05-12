import { NextRequest, NextResponse } from "next/server";
import { getPlanExecutionElapsedMs, pausePlanExecution, PlanExecutionError } from "@/lib/server/plan-execution";
import * as dal from "@/lib/server/dal";
import { handleRoomRouteError, requireRoomAccess } from "@/lib/server/room-route-utils";

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
    const { appId, roomId } = await params;
    const { app, room } = await requireRoomAccess(request, appId, roomId);
    pausePlanExecution({ appId: app.id, roomId: room.id });
    return NextResponse.json(serializePlan(room.id));
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    if (e instanceof PlanExecutionError) {
      return NextResponse.json({ detail: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
