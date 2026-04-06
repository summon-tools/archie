import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { readSkillsIndex } from "@/lib/server/skills";

/**
 * GET: Returns the skills index (list of skills with title + description).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }
    if (!app.directory) {
      return NextResponse.json({ detail: "App has no directory" }, { status: 400 });
    }

    const index = readSkillsIndex(app.directory);
    return NextResponse.json({
      entries: index?.entries || [],
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
