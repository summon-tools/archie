import { NextRequest, NextResponse } from "next/server";
import { PlanExecutionError, resumePlanExecution } from "@/lib/server/plan-execution";
import { handleRoomRouteError, requireRoomAccess, serializeRoomPlan } from "@/lib/server/room-route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { app, room } = await requireRoomAccess(request, appId, roomId);
    resumePlanExecution({ appId: app.id, roomId: room.id });
    return NextResponse.json(serializeRoomPlan(room.id));
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    if (e instanceof PlanExecutionError) {
      return NextResponse.json({ detail: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
