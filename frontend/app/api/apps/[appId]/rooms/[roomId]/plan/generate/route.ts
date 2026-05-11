import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { getHomeAgent } from "@/lib/home/agents";
import { generateRoomPlanFromDiscussion } from "@/lib/server/room-plan-generator";

function serializePlan(roomId: number) {
  const room = dal.getRoom(roomId);
  const plan = dal.getPlansByRoom(roomId)[0] || null;
  const steps = plan ? dal.getPlanSteps(plan.id).map((step) => ({
    ...step,
    events: dal.getPlanStepEvents(step.id),
  })) : [];
  return {
    plan,
    steps,
    planning_context_md: room?.planning_context_md || "",
    planning_context_updated_at: room?.planning_context_updated_at || null,
  };
}

function getRoomForApp(appId: number, roomId: number) {
  const app = dal.getApp(appId);
  if (!app) return { error: NextResponse.json({ detail: "App not found" }, { status: 404 }) };

  const room = dal.getRoom(roomId);
  if (!room || room.app_id !== app.id) {
    return { error: NextResponse.json({ detail: "Room not found" }, { status: 404 }) };
  }

  return { app, room };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId } = await params;
    const result = getRoomForApp(Number(appId), Number(roomId));
    if (result.error) return result.error;

    await generateRoomPlanFromDiscussion({
      app: result.app!,
      room: result.room!,
      agent: getHomeAgent("coordinator"),
    });

    return NextResponse.json(serializePlan(result.room!.id), { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    const detail = e instanceof Error && e.message.includes("Plan generator")
      ? "The model returned an unstructured plan response. Please try again."
      : e instanceof Error ? e.message : "Failed to generate plan";
    return NextResponse.json({ detail }, { status: 500 });
  }
}
