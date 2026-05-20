import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { getPullRequest, parseGitHubRemoteUrl } from "@/lib/server/github";
import { getStatus as getGitStatus } from "@/lib/server/git";
import { getValidGitHubUserToken, GitHubAppError } from "@/lib/server/github-app";

export async function GET(
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
  const gitDir = env?.worktree_dir || app.directory;
  if (!gitDir) {
    return NextResponse.json({ state: "unknown" });
  }

  const prArt = dal.getArtifactByKind(wi.id, "pull_request");
  let prMeta: any = {};
  if (prArt?.metadata_json) try { prMeta = JSON.parse(prArt.metadata_json); } catch {}
  if (!prMeta.pr_number) {
    return NextResponse.json({ state: "unknown" });
  }

  let githubAuth;
  try {
    githubAuth = await getValidGitHubUserToken(currentUser.id);
  } catch (e) {
    if (e instanceof GitHubAppError) {
      return NextResponse.json({ state: "unknown", detail: e.message });
    }
    throw e;
  }

  const status = getGitStatus(gitDir);
  const parsed = status.remote_url ? parseGitHubRemoteUrl(status.remote_url) : null;
  if (!parsed) {
    return NextResponse.json({ state: "unknown" });
  }

  const prInfo = await getPullRequest({
    owner: parsed.owner,
    repo: parsed.repo,
    pr_number: prMeta.pr_number,
    token: githubAuth.token,
  });
  if (!prInfo) {
    return NextResponse.json({ state: "unknown" });
  }

  return NextResponse.json({
    state: prInfo.state, // "OPEN" | "CLOSED" | "MERGED"
    pr_url: prInfo.pr_url,
    pr_number: prInfo.pr_number,
    title: prInfo.title,
  });
}
