import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { getStatus } from "@/lib/server/git";
import type { AppRow } from "@/lib/server/types";

export async function GET(
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

  const status = getStatus(app.directory);

  // If app has a github_repo but git has no remote, include it
  if (app.github_repo && !status.has_remote) {
    status.github_repo = app.github_repo;
  }

  return NextResponse.json(status);
}
