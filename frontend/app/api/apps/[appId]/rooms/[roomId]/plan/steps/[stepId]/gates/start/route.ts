import { NextRequest, NextResponse } from "next/server";
import { PlanExecutionError, startPlanStepGates } from "@/lib/server/plan-execution";
import { handleRoomRouteError, requirePlanStepAccess } from "@/lib/server/room-route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string; stepId: string }> },
) {
  try {
    const { appId, roomId, stepId } = await params;
    const access = await requirePlanStepAccess(request, appId, roomId, stepId);
    const result = startPlanStepGates({
      appId: access.app.id,
      roomId: access.room.id,
      stepId: access.step.id,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    if (e instanceof PlanExecutionError) {
      return NextResponse.json({ detail: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
