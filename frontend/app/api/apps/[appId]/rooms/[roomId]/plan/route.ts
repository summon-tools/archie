import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

function getRoomForApp(appId: number, roomId: number) {
  const app = dal.getApp(appId);
  if (!app) return { error: NextResponse.json({ detail: "App not found" }, { status: 404 }) };

  const room = dal.getRoom(roomId);
  if (!room || room.app_id !== app.id) {
    return { error: NextResponse.json({ detail: "Room not found" }, { status: 404 }) };
  }

  return { app, room };
}

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId } = await params;
    const result = getRoomForApp(Number(appId), Number(roomId));
    if (result.error) return result.error;

    return NextResponse.json(serializePlan(result.room!.id));
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
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

    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ detail: "title is required" }, { status: 400 });
    }

    dal.createPlan({
      room_id: result.room!.id,
      title,
      summary_md: typeof body.summary_md === "string" ? body.summary_md : "",
      status: body.status || "draft",
    });

    return NextResponse.json(serializePlan(result.room!.id), { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId } = await params;
    const result = getRoomForApp(Number(appId), Number(roomId));
    if (result.error) return result.error;

    const plan = dal.getPlansByRoom(result.room!.id)[0];
    if (!plan) {
      return NextResponse.json({ detail: "Plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const fields: Record<string, unknown> = {};
    if (body.title !== undefined) fields.title = String(body.title).trim();
    if (body.summary_md !== undefined) fields.summary_md = String(body.summary_md);
    if (body.status !== undefined) fields.status = body.status;
    if (body.current_version !== undefined) fields.current_version = Number(body.current_version);

    dal.updatePlan(plan.id, fields);
    return NextResponse.json(serializePlan(result.room!.id));
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
