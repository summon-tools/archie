import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { push, isGitInitialized, initRepo } from "@/lib/server/git";
import type { AppRow } from "@/lib/server/types";
import {
  getArchieCoAuthor,
  getValidGitHubUserToken,
  githubAuthorFromConnection,
  GitHubAppError,
} from "@/lib/server/github-app";

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
  const { commit_message, branch } = body;

  const db = getDb();
  const app = db
    .prepare("SELECT * FROM apps WHERE id = ?")
    .get(appId) as AppRow | undefined;

  if (!app) {
    return NextResponse.json({ detail: "App not found" }, { status: 404 });
  }

  if (!app.directory) {
    return NextResponse.json(
      { detail: "App has no directory configured" },
      { status: 400 }
    );
  }

  // Auto-init if needed
  if (!isGitInitialized(app.directory)) {
    const initResult = initRepo(app.directory);
    if (!initResult.success) {
      return NextResponse.json(
        { detail: `Failed to initialize git: ${initResult.message}` },
        { status: 500 }
      );
    }
  }

  let githubAuth;
  try {
    githubAuth = await getValidGitHubUserToken(currentUser.id);
  } catch (e) {
    if (e instanceof GitHubAppError) {
      return NextResponse.json({ detail: e.message }, { status: e.status });
    }
    throw e;
  }

  const result = push(app.directory, commit_message || "", {
    branch,
    author: githubAuthorFromConnection(githubAuth.connection, currentUser.name),
    coAuthor: getArchieCoAuthor(),
    token: githubAuth.token,
  });

  if (!result.success) {
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  return NextResponse.json({
    message: result.message,
    commit_hash: result.commit_hash,
  });
}
