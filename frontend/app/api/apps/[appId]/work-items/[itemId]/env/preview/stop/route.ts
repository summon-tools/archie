import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { stopPreview } from "@/lib/server/worktrees";

export async function POST(
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
  const previewDir = env?.worktree_dir || app.directory || null;
  const result = stopPreview(env?.preview_pid ?? null, previewDir, env?.preview_port ?? null, { appId: Number(appId), workItemId: wi.id });

  dal.updateWorkItemEnv(wi.id, {
    preview_pid: null,
    preview_port: null,
  });

  return NextResponse.json({
    success: result.success,
    message: result.message,
  });
}
