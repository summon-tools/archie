import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getHomeAgent } from "@/lib/home/agents";
import { generateRoomPlanFromDiscussion } from "@/lib/server/room-plan-generator";
import { getPlanExecutionElapsedMs } from "@/lib/server/plan-execution";
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

    await generateRoomPlanFromDiscussion({
      app,
      room,
      agent: getHomeAgent("coordinator"),
    });

    return NextResponse.json(serializePlan(room.id), { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    const detail = e instanceof Error && e.message.includes("Plan generator")
      ? "The model returned an unstructured plan response. Please try again."
      : e instanceof Error ? e.message : "Failed to generate plan";
    return NextResponse.json({ detail }, { status: 500 });
  }
}
