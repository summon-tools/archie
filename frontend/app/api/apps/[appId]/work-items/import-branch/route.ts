import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { enrichWorkItem } from "@/lib/server/work-item-view";
import { createWorktreeFromBranch } from "@/lib/server/worktrees";
import { getValidGitHubUserToken, GitHubAppError } from "@/lib/server/github-app";
import { handleRoomRouteError, readJsonBody, requireAppAccess } from "@/lib/server/room-route-utils";

function normalizeTitle(branchName: string): string {
  return `Branch: ${branchName}`.slice(0, 80);
}

function githubBranchAuthMessage(error: GitHubAppError): string {
  if (error.code === "github_user_not_connected") {
    return "Connect your GitHub account before opening a remote branch.";
  }
  if (error.code === "github_user_reconnect_required") {
    return "Reconnect your GitHub account before opening a remote branch.";
  }
  return error.message;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const { appId } = await params;
    const access = await requireAppAccess(request, appId);
    const body = await readJsonBody(request);
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 80)
      : normalizeTitle(branch);

    if (!branch) {
      return NextResponse.json({ detail: "branch is required" }, { status: 400 });
    }
    if (!access.app.directory) {
      return NextResponse.json({ detail: "App has no directory configured" }, { status: 400 });
    }

    let githubToken: string | null = null;
    let githubAuthError: string | null = null;
    try {
      githubToken = (await getValidGitHubUserToken(access.user.id)).token;
    } catch (error) {
      if (error instanceof GitHubAppError) {
        githubAuthError = githubBranchAuthMessage(error);
      } else {
        throw error;
      }
    }

    const conversation = dal.createConversation({
      app_id: access.app.id,
      kind: "task",
      title,
      created_by: access.user.id,
    });

    const workItem = dal.createWorkItem({
      app_id: access.app.id,
      primary_conversation_id: conversation.id,
      title,
      summary: "",
      kind: "task",
      created_by: access.user.id,
    });

    dal.ensureWorkItemEnv(workItem.id);
    dal.updateWorkItemEnv(workItem.id, {
      worktree_status: "preparing",
      branch_source: "imported",
      delete_branch_on_remove: 0,
    });

    const worktree = createWorktreeFromBranch(access.app.directory, workItem.id, branch, {
      token: githubToken,
    });

    if (!worktree.success) {
      dal.updateWorkItemEnv(workItem.id, { worktree_status: "failed" });
      dal.deleteWorkItem(workItem.id);
      try { dal.deleteConversation(conversation.id); } catch {}
      const detail = githubAuthError
        ? `${githubAuthError} Archie could not open the branch with local git credentials either: ${worktree.message}`
        : worktree.message;
      return NextResponse.json({ detail }, { status: 422 });
    }

    dal.updateWorkItemEnv(workItem.id, {
      branch_name: worktree.branch_name,
      worktree_dir: worktree.worktree_dir,
      worktree_status: "ready",
      branch_source: "imported",
      delete_branch_on_remove: 0,
    });

    const enriched = enrichWorkItem({
      ...workItem,
      created_by_name: access.user.name,
      created_by_color: (access.user as any).color || null,
    });

    return NextResponse.json(enriched, { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
