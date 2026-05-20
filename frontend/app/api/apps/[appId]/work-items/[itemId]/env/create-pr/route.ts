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
      mode: "publish_pr",
    });
    return NextResponse.json({
      success: true,
      message: result.message,
      pr_url: result.pr_url,
      pr_number: result.pr_number,
    });
  } catch (err) {
    if (err instanceof GitWorkflowError || err instanceof GitHubAppError) {
      return NextResponse.json({ detail: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Failed to create PR" },
      { status: 500 }
    );
  }
}
