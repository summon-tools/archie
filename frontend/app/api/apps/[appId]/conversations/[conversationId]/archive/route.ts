import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { execFileSync } from "child_process";
import { runStop } from "@/lib/server/runner";
import { removeWorktree } from "@/lib/server/worktrees";

/**
 * POST /api/apps/{appId}/conversations/{conversationId}/archive
 * Archives a conversation: stops preview, removes worktree, marks work item done, sets conversation archived.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  let user: { id: number };
  try {
    user = await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  const { appId, conversationId } = await params;

  const app = dal.getApp(Number(appId));
  if (!app) {
    return NextResponse.json({ detail: "App not found" }, { status: 404 });
  }

  const conversation = dal.getConversation(Number(conversationId));
  if (!conversation || conversation.app_id !== Number(appId)) {
    return NextResponse.json({ detail: "Conversation not found" }, { status: 404 });
  }

  // Find linked work item (if any)
  const workItem = dal.getWorkItemByConversationId(conversation.id);
  const env = workItem ? dal.getWorkItemEnv(workItem.id) : undefined;

  // Clean up workspace
  if (env) {
    // Stop preview if running
    if (env.preview_pid || env.preview_port) {
      try {
        const previewDir = env.worktree_dir || app.directory;
        runStop(previewDir, env.preview_port ?? undefined);
      } catch { /* best effort */ }
    }

    // Auto-commit any uncommitted changes
    if (env.worktree_dir) {
      try {
        const gitOpts = { cwd: env.worktree_dir, timeout: 10000, encoding: "utf-8" as const, stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"] };
        const status = execFileSync("git", ["status", "--porcelain"], gitOpts);
        if (status.trim()) {
          execFileSync("git", ["add", "-A"], gitOpts);
          execFileSync("git", ["commit", "-m", `Archive: ${workItem?.title || "work item"}`], gitOpts);
        }
      } catch { /* best effort */ }
    }

    // Remove worktree (keep branch for history)
    if (env.worktree_dir && app.directory) {
      try {
        removeWorktree(app.directory, env.worktree_dir, ""); // empty string = keep branch
      } catch { /* best effort */ }
    }

    // Clear env fields
    dal.updateWorkItemEnv(workItem!.id, {
      worktree_dir: null,
      worktree_status: null,
      preview_port: null,
      preview_pid: null,
    });
  }

  // For setup tasks (no worktree, work done on app directory), switch back to main
  if (workItem?.kind === "setup" && app.directory && env?.branch_name) {
    try {
      const gitOpts = { cwd: app.directory, timeout: 10000, encoding: "utf-8" as const, stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"] };
      // Detect default branch
      let defaultBranch = "main";
      try {
        const refResult = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], gitOpts);
        const parsed = refResult.trim().replace("origin/", "");
        if (parsed) defaultBranch = parsed;
      } catch {
        try {
          execFileSync("git", ["rev-parse", "--verify", "master"], gitOpts);
          defaultBranch = "master";
        } catch { /* stick with "main" */ }
      }
      execFileSync("git", ["checkout", defaultBranch], gitOpts);
    } catch { /* best effort */ }
  }

  // Mark work item as done
  if (workItem && workItem.status !== "done") {
    dal.updateWorkItem(workItem.id, {
      status: "done",
      completed_at: new Date().toISOString(),
      completed_by_user_id: user.id,
    });
  }

  // Archive the conversation
  dal.updateConversation(conversation.id, { status: "archived" });

  // Add system message
  dal.addSystemMessage(conversation.id, "Completed — workspace cleaned up");

  return NextResponse.json({
    success: true,
    message: "Conversation archived",
  });
}
