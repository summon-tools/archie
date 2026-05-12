import { NextRequest, NextResponse } from "next/server";
import { getPlanExecutionElapsedMs } from "@/lib/server/plan-execution";
import * as dal from "@/lib/server/dal";
import { handleRoomRouteError, readJsonBody, RouteInputError, requireRoomAccess } from "@/lib/server/room-route-utils";

const CLIENT_EDITABLE_PLAN_STATUSES = new Set(["draft", "ready"]);

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { room } = await requireRoomAccess(request, appId, roomId);

    return NextResponse.json(serializePlan(room.id));
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { room } = await requireRoomAccess(request, appId, roomId);

    const body = await readJsonBody(request);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ detail: "title is required" }, { status: 400 });
    }
    if (dal.getPlansByRoom(room.id)[0]) {
      return NextResponse.json({ detail: "Plan already exists for this room" }, { status: 409 });
    }
    const status = typeof body.status === "string" ? body.status : "draft";
    if (!CLIENT_EDITABLE_PLAN_STATUSES.has(status)) {
      return NextResponse.json({ detail: "status must be draft or ready" }, { status: 400 });
    }

    dal.createPlan({
      room_id: room.id,
      title,
      summary_md: typeof body.summary_md === "string" ? body.summary_md : "",
      status: status as "draft" | "ready",
    });

    return NextResponse.json(serializePlan(room.id), { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { room } = await requireRoomAccess(request, appId, roomId);

    const plan = dal.getPlansByRoom(room.id)[0];
    if (!plan) {
      return NextResponse.json({ detail: "Plan not found" }, { status: 404 });
    }

    const body = await readJsonBody(request);
    const fields: Record<string, unknown> = {};
    if (body.title !== undefined) fields.title = String(body.title).trim();
    if (body.summary_md !== undefined) fields.summary_md = String(body.summary_md);
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !CLIENT_EDITABLE_PLAN_STATUSES.has(body.status)) {
        throw new RouteInputError("status can only be changed to draft or ready");
      }
      fields.status = body.status;
      if (body.status === "ready" || body.status === "draft") {
        fields.execution_state = "idle";
        fields.execution_started_at = null;
        fields.execution_paused_at = null;
        fields.execution_paused_ms = 0;
      }
    }
    if (body.current_version !== undefined) {
      const version = Number(body.current_version);
      if (!Number.isInteger(version) || version < 1) {
        throw new RouteInputError("current_version must be a positive integer");
      }
      fields.current_version = version;
    }

    dal.updatePlan(plan.id, fields);
    return NextResponse.json(serializePlan(room.id));
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
