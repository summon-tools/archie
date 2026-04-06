import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { getPreviewStatus } from "@/lib/server/worktrees";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  const { appId, itemId } = await params;

  const app = dal.getApp(Number(appId));
  if (!app) {
    return NextResponse.json({ detail: "App not found" }, { status: 404 });
  }

  const wi = dal.getWorkItem(Number(itemId));
  if (!wi || wi.app_id !== Number(appId)) {
    return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
  }

  const env = dal.getWorkItemEnv(wi.id);
  const status = getPreviewStatus(env?.preview_port ?? null);

  // If port is assigned but preview is not running, clean up
  if (env?.preview_port && !status.running) {
    dal.updateWorkItemEnv(wi.id, {
      preview_pid: null,
      preview_port: null,
    });
  }

  return NextResponse.json({
    running: status.running,
    port: status.port,
    url: status.url,
  });
}
