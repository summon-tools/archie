import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { removeWorktree, stopPreview } from "@/lib/server/worktrees";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
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
    return NextResponse.json(env || {});
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, itemId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const wi = dal.getWorkItem(Number(itemId));
    if (!wi || wi.app_id !== Number(appId)) {
      return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
    }

    const directory = app.directory;
    if (!directory) {
      return NextResponse.json(
        { detail: "App has no directory configured" },
        { status: 400 }
      );
    }

    const env = dal.getWorkItemEnv(wi.id);
    if (!env || !env.worktree_dir || !env.branch_name) {
      return NextResponse.json(
        { detail: "Work item does not have a worktree" },
        { status: 400 }
      );
    }

    // Stop preview if running
    if (env.preview_pid || env.preview_port) {
      stopPreview(env.preview_pid, env.worktree_dir, env.preview_port, { appId: Number(appId), workItemId: wi.id });
    }

    const branchToDelete = env.delete_branch_on_remove ? env.branch_name : "";
    const result = removeWorktree(directory, env.worktree_dir, branchToDelete);

    // Clear env fields
    dal.updateWorkItemEnv(wi.id, {
      branch_name: null,
      worktree_dir: null,
      branch_source: "generated",
      delete_branch_on_remove: 1,
      preview_port: null,
      preview_pid: null,
      worktree_status: null,
    });

    return NextResponse.json({
      success: result.success,
      message: result.message,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
