import { NextRequest, NextResponse } from "next/server";
import { getValidGitHubUserToken } from "@/lib/server/github-app";
import { handleRouteError, requireAppAccess } from "@/lib/server/route-utils";
import { listRemoteBranches } from "@/lib/server/worktrees";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

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
    try {
      githubToken = (await getValidGitHubUserToken(access.user.id)).token;
    } catch {
      githubToken = null;
    }

    const result = listRemoteBranches(access.app.directory, {
      token: githubToken,
      excludeCheckedOut: true,
    });
    if (!result.success) {
      return NextResponse.json(
        { detail: result.message },
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
    const errorResponse = handleRouteError(e);
    if (errorResponse) {
      errorResponse.headers.set("Cache-Control", noStoreHeaders["Cache-Control"]);
      return errorResponse;
    }
    throw e;
  }
}
