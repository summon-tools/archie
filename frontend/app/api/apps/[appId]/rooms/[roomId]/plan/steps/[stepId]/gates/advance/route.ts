import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { advancePlanStepGate, PlanExecutionError } from "@/lib/server/plan-execution";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string; stepId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId, stepId } = await params;
    const body = await request.json();
    const result = advancePlanStepGate({
      appId: Number(appId),
      roomId: Number(roomId),
      stepId: Number(stepId),
      outcome: body.status === "failed" ? "failed" : "passed",
      summary: typeof body.summary_md === "string" ? body.summary_md : undefined,
      commitSha: typeof body.commit_sha === "string" ? body.commit_sha : null,
    });
    return NextResponse.json(result);
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
