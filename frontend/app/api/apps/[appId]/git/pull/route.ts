import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { GitWorkflowError, pullAppDefaultBranch } from "@/lib/server/git-workflows";
import { GitHubAppError } from "@/lib/server/github-app";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
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

  const { appId } = await params;

  const body = await request.json().catch(() => ({}));
  const { branch } = body;

  try {
    const result = await pullAppDefaultBranch({
      appId: Number(appId),
      user: currentUser,
      branch,
    });
    return NextResponse.json({ message: result.message });
  } catch (e) {
    if (e instanceof GitWorkflowError || e instanceof GitHubAppError) {
      return NextResponse.json({ detail: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "Failed to pull from GitHub" },
      { status: 500 },
    );
  }
}
