import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { push, isGitInitialized, initRepo } from "@/lib/server/git";
import type { AppRow } from "@/lib/server/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
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

  const result = push(app.directory, commit_message || "", branch);

  if (!result.success) {
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  return NextResponse.json({
    message: result.message,
    commit_hash: result.commit_hash,
  });
}
