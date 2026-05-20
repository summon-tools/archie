import { NextRequest, NextResponse } from "next/server";
import { getValidGitHubUserToken, GitHubAppError } from "@/lib/server/github-app";
import { handleRoomRouteError, requireAppAccess } from "@/lib/server/room-route-utils";
import { listRemoteBranchesForApp } from "@/lib/server/worktrees";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

function githubBranchAuthMessage(error: GitHubAppError): string {
  if (error.code === "github_user_not_connected") {
    return "Connect your GitHub account before loading remote branches.";
  }
  if (error.code === "github_user_reconnect_required") {
    return "Reconnect your GitHub account before loading remote branches.";
  }
  return error.message;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const { appId } = await params;
    const access = await requireAppAccess(request, appId);
    if (!access.app.directory) {
      return NextResponse.json(
        { detail: "App has no directory configured" },
        { status: 400, headers: noStoreHeaders },
      );
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

    const result = await listRemoteBranchesForApp(access.app.directory, {
      token: githubToken,
      excludeCheckedOut: true,
    });
    if (!result.success) {
      const detail = githubAuthError
        ? `${githubAuthError} Archie could not load branches with local git credentials either: ${result.message}`
        : result.message;
      return NextResponse.json(
        { detail },
        { status: 422, headers: noStoreHeaders },
      );
    }

    return NextResponse.json(
      {
        branches: result.branches,
        checked_out_branches: result.checked_out_branches,
      },
      { headers: noStoreHeaders },
    );
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) {
      errorResponse.headers.set("Cache-Control", noStoreHeaders["Cache-Control"]);
      return errorResponse;
    }
    throw e;
  }
}
