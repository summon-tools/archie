import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { enrichWorkItem } from "@/lib/server/work-item-view";
import { createWorktreeFromBranch } from "@/lib/server/worktrees";
import { getValidGitHubUserToken } from "@/lib/server/github-app";
import { handleRoomRouteError, readJsonBody, requireAppAccess } from "@/lib/server/room-route-utils";

function normalizeTitle(branchName: string): string {
  return `Branch: ${branchName}`.slice(0, 80);
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
    try {
      githubToken = (await getValidGitHubUserToken(access.user.id)).token;
    } catch {
      githubToken = null;
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
      summary: `Imported existing branch ${branch}`,
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
      return NextResponse.json({ detail: worktree.message }, { status: 422 });
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
