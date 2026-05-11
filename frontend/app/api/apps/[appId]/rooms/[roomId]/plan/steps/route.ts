import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

function getRoomPlan(appId: number, roomId: number) {
  const app = dal.getApp(appId);
  if (!app) return { error: NextResponse.json({ detail: "App not found" }, { status: 404 }) };

  const room = dal.getRoom(roomId);
  if (!room || room.app_id !== app.id) {
    return { error: NextResponse.json({ detail: "Room not found" }, { status: 404 }) };
  }

  const plan = dal.getPlansByRoom(room.id)[0];
  if (!plan) {
    return { error: NextResponse.json({ detail: "Plan not found" }, { status: 404 }) };
  }

  return { app, room, plan };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId } = await params;
    const result = getRoomPlan(Number(appId), Number(roomId));
    if (result.error) return result.error;

    return NextResponse.json({ steps: dal.getPlanSteps(result.plan!.id) });
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
    const result = getRoomPlan(Number(appId), Number(roomId));
    if (result.error) return result.error;

    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ detail: "title is required" }, { status: 400 });
    }

    const step = dal.createPlanStep({
      plan_id: result.plan!.id,
      title,
      position: body.position === undefined ? undefined : Number(body.position),
      objective_md: typeof body.objective_md === "string" ? body.objective_md : "",
      implementation_prompt_md: typeof body.implementation_prompt_md === "string" ? body.implementation_prompt_md : "",
      acceptance_criteria_md: typeof body.acceptance_criteria_md === "string" ? body.acceptance_criteria_md : "",
      risk_level: body.risk_level || "medium",
      requires_architecture_review: !!body.requires_architecture_review,
      requires_security_review: !!body.requires_security_review,
      requires_browser_validation: !!body.requires_browser_validation,
    });

    return NextResponse.json(step, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
