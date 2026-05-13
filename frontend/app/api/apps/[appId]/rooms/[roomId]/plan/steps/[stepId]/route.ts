import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { handleRoomRouteError, readJsonBody, RouteInputError, requirePlanStepAccess } from "@/lib/server/room-route-utils";

const EDITABLE_STEP_FIELDS = new Set([
  "title",
  "objective_md",
  "implementation_prompt_md",
  "acceptance_criteria_md",
  "risk_level",
  "requires_architecture_review",
  "requires_security_review",
]);
const PLAN_STEP_RISK_LEVELS = new Set(["low", "medium", "high"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string; stepId: string }> },
) {
  try {
    const { appId, roomId, stepId } = await params;
    const { plan, step } = await requirePlanStepAccess(request, appId, roomId, stepId);
    if (plan.status !== "draft" && plan.status !== "ready") {
      throw new RouteInputError("Plan steps cannot be edited after execution starts", 409);
    }

    const body = await readJsonBody(request);
    for (const key of Object.keys(body)) {
      if (!EDITABLE_STEP_FIELDS.has(key)) {
        throw new RouteInputError(`Field ${key} cannot be updated through this endpoint`);
      }
    }

    const fields: Record<string, unknown> = {};
    for (const key of ["title", "objective_md", "implementation_prompt_md", "acceptance_criteria_md"] as const) {
      if (body[key] !== undefined) fields[key] = String(body[key]);
    }
    if (body.title !== undefined) fields.title = String(body.title).trim();
    if (body.risk_level !== undefined) {
      if (typeof body.risk_level !== "string" || !PLAN_STEP_RISK_LEVELS.has(body.risk_level)) {
        throw new RouteInputError("risk_level must be low, medium, or high");
      }
      fields.risk_level = body.risk_level;
    }
    for (const key of ["requires_architecture_review", "requires_security_review"] as const) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== "boolean") {
          throw new RouteInputError(`${key} must be a boolean`);
        }
        fields[key] = body[key];
      }
    }

    dal.updatePlanStep(step.id, fields);
    return NextResponse.json(dal.getPlanStep(step.id));
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
