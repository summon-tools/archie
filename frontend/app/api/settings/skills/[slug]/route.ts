import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { parseGlobalSkillPayload, parseGlobalSkillRouteSlug } from "@/lib/server/global-skill-validation";
import { handleRoomRouteError, readJsonBody, RouteInputError } from "@/lib/server/room-route-utils";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("unique");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    await requireAdmin(request);
    const { slug: rawSlug } = await params;
    const slug = parseGlobalSkillRouteSlug(rawSlug);
    const skill = dal.getGlobalSkillBySlug(slug);
    if (!skill) throw new RouteInputError("Skill not found", 404);
    return NextResponse.json({ skill });
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const user = await requireAdmin(request);
    const { slug: rawSlug } = await params;
    const slug = parseGlobalSkillRouteSlug(rawSlug);
    const body = await readJsonBody(request);
    const payload = parseGlobalSkillPayload(body, { partial: true });

    try {
      const skill = dal.updateGlobalSkill(slug, { ...payload, updated_by: user.id });
      if (!skill) throw new RouteInputError("Skill not found", 404);
      return NextResponse.json({ skill });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new RouteInputError("A skill with that slash command already exists", 409);
      }
      throw error;
    }
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    await requireAdmin(request);
    const { slug: rawSlug } = await params;
    const slug = parseGlobalSkillRouteSlug(rawSlug);
    const deleted = dal.deleteGlobalSkill(slug);
    if (!deleted) throw new RouteInputError("Skill not found", 404);
    return NextResponse.json({ deleted: slug });
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
