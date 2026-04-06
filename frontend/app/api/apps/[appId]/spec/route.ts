import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { readSpecIndex } from "@/lib/server/spec";

/**
 * GET: Returns the spec index (list of files + summaries).
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

    const index = readSpecIndex(app.directory);
    return NextResponse.json({
      exists: !!index,
      appName: index?.appName || app.name,
      entries: index?.entries || [],
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
