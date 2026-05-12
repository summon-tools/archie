import { NextRequest, NextResponse } from "next/server";
import { advancePlanStepGate, PlanExecutionError } from "@/lib/server/plan-execution";
import { handleRoomRouteError, readJsonBody, RouteInputError, requirePlanStepAccess } from "@/lib/server/room-route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string; stepId: string }> },
) {
  try {
    const { appId, roomId, stepId } = await params;
    const access = await requirePlanStepAccess(request, appId, roomId, stepId);
    const body = await readJsonBody(request);
    if (body.status !== "passed" && body.status !== "failed") {
      throw new RouteInputError("status must be passed or failed");
    }
    const result = advancePlanStepGate({
      appId: access.app.id,
      roomId: access.room.id,
      stepId: access.step.id,
      outcome: body.status,
      summary: typeof body.summary_md === "string" ? body.summary_md : undefined,
      commitSha: typeof body.commit_sha === "string" ? body.commit_sha : null,
    });
    return NextResponse.json(result);
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    if (e instanceof PlanExecutionError) {
      return NextResponse.json({ detail: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
