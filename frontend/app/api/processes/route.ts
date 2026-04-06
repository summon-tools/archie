import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { getActiveProcess, listProcesses } from "@/lib/server/dal/processes";

/**
 * GET /api/processes?app_id=&work_item_id=&kind=preview
 * Get active managed process info.
 */
export async function GET(request: NextRequest) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  const url = new URL(request.url);
  const appId = url.searchParams.get("app_id");
  const workItemId = url.searchParams.get("work_item_id");
  const kind = url.searchParams.get("kind") || "preview";

  if (!appId) {
    return NextResponse.json({ detail: "app_id is required" }, { status: 400 });
  }

  const numAppId = parseInt(appId, 10);
  const numWorkItemId = workItemId ? parseInt(workItemId, 10) : null;

  const process = getActiveProcess(numAppId, kind, numWorkItemId);

  return NextResponse.json({ process: process || null });
}
