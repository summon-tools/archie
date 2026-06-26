import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { startPreview, allocatePort } from "@/lib/server/worktrees";
import { getDb } from "@/lib/server/db";

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

  // Use worktree directory if available, otherwise fall back to app directory
  // (setup tasks work directly in the app directory on the setup branch)
  const previewDir = env?.worktree_dir || app.directory;
  if (!previewDir) {
    return NextResponse.json(
      { detail: "No directory available for preview. Create a worktree or set app directory." },
      { status: 400 }
    );
  }

  // Allocate a port, excluding ports already in use
  const db = getDb();
  const usedPorts = (
    db
      .prepare("SELECT preview_port FROM work_item_env WHERE preview_port IS NOT NULL AND work_item_id != ?")
      .all(wi.id) as { preview_port: number }[]
  ).map((r) => r.preview_port);

  const port = allocatePort(usedPorts);
  if (!port) {
    return NextResponse.json(
      { detail: "No available ports for preview" },
      { status: 503 }
    );
  }

  // Ensure env row exists for setup tasks that don't have a worktree
  dal.ensureWorkItemEnv(wi.id);

  const result = await startPreview(previewDir, port, undefined, { appId: Number(appId), workItemId: wi.id });

  if (!result.success) {
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  dal.updateWorkItemEnv(wi.id, {
    preview_port: port,
    preview_pid: result.pid,
  });

  return NextResponse.json({
    success: true,
    message: result.message,
    port,
    pid: result.pid,
    url: `/api/p/${port}`,
    healthy: result.healthy,
    statusCode: result.statusCode,
  });
}
