import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { launchNextPlanStep, PlanExecutionError } from "@/lib/server/plan-execution";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const authUser = await getAuthUser(request);
    const { appId, roomId } = await params;
    const result = launchNextPlanStep({
      appId: Number(appId),
      roomId: Number(roomId),
      userId: authUser.id,
    });

    return NextResponse.json({
      plan: result.plan,
      step: result.step,
      conversation: result.conversation,
      work_item: result.workItem,
    }, { status: 201 });
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
