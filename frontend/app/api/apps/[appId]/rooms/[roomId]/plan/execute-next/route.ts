import { NextRequest, NextResponse } from "next/server";
import { launchNextPlanStep, PlanExecutionError } from "@/lib/server/plan-execution";
import { handleRoomRouteError, requireRoomAccess } from "@/lib/server/room-route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const access = await requireRoomAccess(request, appId, roomId);
    const result = launchNextPlanStep({
      appId: access.app.id,
      roomId: access.room.id,
      userId: access.user.id,
    });

    return NextResponse.json({
      plan: result.plan,
      step: result.step,
      conversation: result.conversation,
      work_item: result.workItem,
    }, { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    if (e instanceof PlanExecutionError) {
      return NextResponse.json({ detail: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
