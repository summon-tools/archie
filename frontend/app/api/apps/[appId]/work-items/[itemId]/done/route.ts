import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import {
  removeWorktree,
  stopPreview,
  runGitSafe,
} from "@/lib/server/worktrees";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    const user = await getAuthUser(request);
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

    // Stop preview if running
    if (env && (env.preview_pid || env.preview_port)) {
      stopPreview(env.preview_pid, env.worktree_dir, env.preview_port, { appId: Number(appId), workItemId: wi.id });
    }

    // Auto-commit and clean up worktree (but don't merge or delete branch)
    if (env?.worktree_dir && env.branch_name && app.directory) {
      const status = runGitSafe(env.worktree_dir, ["status", "--porcelain"]);
      if (status.stdout.trim()) {
        runGitSafe(env.worktree_dir, ["add", "-A"]);
        runGitSafe(env.worktree_dir, [
          "commit",
          "-m",
          `Work item #${wi.id}: ${wi.title}`,
        ]);
      }

      // Remove worktree but keep the branch
      removeWorktree(app.directory, env.worktree_dir, "");
    }

    // Update work item status to done
    dal.updateWorkItem(wi.id, {
      status: "done",
      completed_at: new Date().toISOString(),
      completed_by_user_id: user.id,
    });

    // Clear env fields
    if (env) {
      dal.updateWorkItemEnv(wi.id, {
        worktree_dir: null,
        preview_port: null,
        preview_pid: null,
        worktree_status: null,
      });
    }

    // Close the conversation
    if (wi.primary_conversation_id) {
      dal.updateConversation(wi.primary_conversation_id, { status: "closed" });
    }

    const updated = dal.getWorkItem(wi.id)!;
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
