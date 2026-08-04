import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { parseGlobalSkillPayload } from "@/lib/server/global-skill-validation";
import { handleRouteError, readJsonBody, RouteInputError } from "@/lib/server/route-utils";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("unique");
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json({ skills: dal.listGlobalSkills() });
  } catch (error) {
    const errorResponse = handleRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request);
    const body = await readJsonBody(request);
    const payload = parseGlobalSkillPayload(body);
    if (!payload.slug || !payload.name || payload.description === undefined || payload.body_md === undefined || !payload.trigger_phrases || payload.enabled === undefined) {
      throw new RouteInputError("Skill payload is incomplete");
    }

    try {
      const skill = dal.createGlobalSkill({
        slug: payload.slug,
        name: payload.name,
        description: payload.description,
        body_md: payload.body_md,
        parts: payload.parts ?? [],
        trigger_phrases: payload.trigger_phrases,
        enabled: payload.enabled,
        created_by: user.id,
        updated_by: user.id,
      });
      return NextResponse.json({ skill }, { status: 201 });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new RouteInputError("A skill with that slash command already exists", 409);
      }
      throw error;
    }
  } catch (error) {
    const errorResponse = handleRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
