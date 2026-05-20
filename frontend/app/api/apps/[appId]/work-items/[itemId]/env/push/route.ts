import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { GitWorkflowError, publishWorkItemBranch } from "@/lib/server/git-workflows";
import { GitHubAppError } from "@/lib/server/github-app";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  let currentUser: Awaited<ReturnType<typeof getAuthUser>>;
  try {
    currentUser = await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  try {
    const { appId, itemId } = await params;
    const result = await publishWorkItemBranch({
      appId: Number(appId),
      workItemId: Number(itemId),
      user: currentUser,
      mode: "push",
    });
    return NextResponse.json({
      success: true,
      message: result.message,
      commit_hash: result.commit_hash,
    });
  } catch (e) {
    if (e instanceof GitWorkflowError || e instanceof GitHubAppError) {
      return NextResponse.json({ detail: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "Failed to push branch" },
      { status: 500 },
    );
  }
}
