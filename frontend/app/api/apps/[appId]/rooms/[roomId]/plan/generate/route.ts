import { NextRequest, NextResponse } from "next/server";
import { resolveHomeAgent } from "@/lib/server/home-agent-configs";
import { generateRoomPlanFromDiscussion, RoomPlanGenerationError } from "@/lib/server/room-plan-generator";
import { handleRoomRouteError, requireRoomAccess, serializeRoomPlan } from "@/lib/server/room-route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { app, room } = await requireRoomAccess(request, appId, roomId);

    await generateRoomPlanFromDiscussion({
      app,
      room,
      agent: resolveHomeAgent("coordinator"),
    });

    return NextResponse.json(serializeRoomPlan(room.id), { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    if (e instanceof RoomPlanGenerationError) {
      return NextResponse.json({ detail: e.message, code: e.code }, { status: e.status });
    }
    const detail = e instanceof Error && e.message.includes("Plan generator")
      ? "The model returned an unstructured plan response. Please try again."
      : e instanceof Error ? e.message : "Failed to generate plan";
    return NextResponse.json({ detail }, { status: 500 });
  }
}
