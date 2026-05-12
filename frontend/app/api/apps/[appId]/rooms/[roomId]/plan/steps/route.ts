import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { handleRoomRouteError, readJsonBody, RouteInputError, requireRoomPlanAccess } from "@/lib/server/room-route-utils";

const PLAN_STEP_RISK_LEVELS = new Set(["low", "medium", "high"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { plan } = await requireRoomPlanAccess(request, appId, roomId);

    return NextResponse.json({ steps: dal.getPlanSteps(plan.id) });
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
    const { plan } = await requireRoomPlanAccess(request, appId, roomId);

    const body = await readJsonBody(request);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ detail: "title is required" }, { status: 400 });
    }
    const riskLevel = typeof body.risk_level === "string" ? body.risk_level : "medium";
    if (!PLAN_STEP_RISK_LEVELS.has(riskLevel)) {
      throw new RouteInputError("risk_level must be low, medium, or high");
    }
    const position = body.position === undefined ? undefined : Number(body.position);
    if (position !== undefined && (!Number.isInteger(position) || position < 0)) {
      throw new RouteInputError("position must be a non-negative integer");
    }

    const step = dal.createPlanStep({
      plan_id: plan.id,
      title,
      position,
      objective_md: typeof body.objective_md === "string" ? body.objective_md : "",
      implementation_prompt_md: typeof body.implementation_prompt_md === "string" ? body.implementation_prompt_md : "",
      acceptance_criteria_md: typeof body.acceptance_criteria_md === "string" ? body.acceptance_criteria_md : "",
      risk_level: riskLevel as "low" | "medium" | "high",
      requires_architecture_review: !!body.requires_architecture_review,
      requires_security_review: !!body.requires_security_review,
      requires_browser_validation: !!body.requires_browser_validation,
    });

    return NextResponse.json(step, { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
