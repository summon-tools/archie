import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { createWorktree } from "@/lib/server/worktrees";

export async function POST(
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
    if (env?.worktree_dir) {
      return NextResponse.json(
        { detail: "Work item already has a worktree", worktree_dir: env.worktree_dir, branch_name: env.branch_name },
        { status: 409 }
      );
    }

    const result = createWorktree(directory, wi.id, wi.title);

    if (!result.success) {
      return NextResponse.json({ detail: result.message }, { status: 500 });
    }

    dal.updateWorkItemEnv(wi.id, {
      branch_name: result.branch_name,
      worktree_dir: result.worktree_dir,
      worktree_status: "ready",
    });

    return NextResponse.json({
      success: true,
      message: result.message,
      branch_name: result.branch_name,
      worktree_dir: result.worktree_dir,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
