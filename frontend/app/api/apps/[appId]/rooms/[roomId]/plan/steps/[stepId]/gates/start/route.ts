import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { PlanExecutionError, startPlanStepGates } from "@/lib/server/plan-execution";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string; stepId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId, stepId } = await params;
    const result = startPlanStepGates({
      appId: Number(appId),
      roomId: Number(roomId),
      stepId: Number(stepId),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof PlanExecutionError) {
      return NextResponse.json({ detail: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
