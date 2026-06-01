import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { filterAppsForUser } from "@/lib/server/room-route-utils";
import { GitHubAppError, getValidGitHubUserToken } from "@/lib/server/github-app";
import { buildOutcomesSummary } from "@/lib/server/outcomes";

export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthUser>>;
  try {
    user = await getAuthUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ detail: error.message }, { status: 401 });
    }
    throw error;
  }

  const apps = filterAppsForUser(user, dal.getApps());
  let githubToken: string | null = null;
  let githubUnavailableWarning: string | undefined;

  try {
    githubToken = (await getValidGitHubUserToken(user.id)).token;
  } catch (error) {
    githubUnavailableWarning = error instanceof GitHubAppError
      ? "GitHub is not connected for this user, so PR states are based on local Archie evidence only."
      : "GitHub auth failed, so PR states are based on local Archie evidence only.";
  }

  try {
    const summary = await buildOutcomesSummary({
      apps,
      githubToken,
      githubUnavailableWarning,
      maxGithubLookups: 25,
    });
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Failed to load outcomes summary" },
      { status: 500 },
    );
  }
}
