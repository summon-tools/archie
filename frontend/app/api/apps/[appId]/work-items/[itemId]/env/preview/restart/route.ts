import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { stopPreview, startPreview, allocatePort } from "@/lib/server/worktrees";
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
  const previewDir = env?.worktree_dir || app.directory;
  if (!previewDir) {
    return NextResponse.json(
      { detail: "No directory available for preview" },
      { status: 400 }
    );
  }

  // Stop existing preview if running
  if (env?.preview_pid || env?.preview_port) {
    stopPreview(env!.preview_pid, previewDir, env!.preview_port, { appId: Number(appId), workItemId: wi.id });
  }

  // Ensure env row exists for setup tasks without a worktree
  dal.ensureWorkItemEnv(wi.id);

  // Allocate port (prefer reusing the same port)
  const db = getDb();
  const usedPorts = (
    db
      .prepare("SELECT preview_port FROM work_item_env WHERE preview_port IS NOT NULL AND work_item_id != ?")
      .all(wi.id) as { preview_port: number }[]
  ).map((r) => r.preview_port);

  const port = env?.preview_port && !usedPorts.includes(env.preview_port)
    ? env.preview_port
    : allocatePort(usedPorts);

  if (!port) {
    dal.updateWorkItemEnv(wi.id, {
      preview_pid: null,
      preview_port: null,
    });
    return NextResponse.json(
      { detail: "No available ports for preview" },
      { status: 503 }
    );
  }

  // Brief delay to let the old process release the port
  await new Promise((r) => setTimeout(r, 500));

  const result = await startPreview(previewDir, port, undefined, { appId: Number(appId), workItemId: wi.id });

  if (!result.success) {
    dal.updateWorkItemEnv(wi.id, {
      preview_pid: null,
      preview_port: null,
    });
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  dal.updateWorkItemEnv(wi.id, {
    preview_port: port,
    preview_pid: result.pid,
  });

  return NextResponse.json({
    success: true,
    message: "Preview restarted",
    port,
    pid: result.pid,
    healthy: result.healthy,
    statusCode: result.statusCode,
  });
}
