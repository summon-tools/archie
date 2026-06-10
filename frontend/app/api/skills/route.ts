import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { handleRoomRouteError } from "@/lib/server/room-route-utils";

export async function GET(request: NextRequest) {
  try {
    await getAuthUser(request);
    const skills = dal.listGlobalSkills({ enabledOnly: true }).map((skill) => ({
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      trigger_phrases: skill.trigger_phrases,
      enabled: skill.enabled,
    }));
    return NextResponse.json({ skills });
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
