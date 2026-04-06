import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import {
  setRemote,
  normalizeGithubUrl,
  isGitInitialized,
  initRepo,
} from "@/lib/server/git";
import type { AppRow } from "@/lib/server/types";
import { setRemoteSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

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

  const body = await request.json();
  const parsed = setRemoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: formatZodError(parsed.error) },
      { status: 400 }
    );
  }
  const { repo_url } = parsed.data;

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

  // Normalize URL to SSH
  const sshUrl = normalizeGithubUrl(repo_url);

  const result = setRemote(app.directory, sshUrl);

  if (!result.success) {
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  // Store ssh_url in DB
  db.prepare("UPDATE apps SET github_repo = ? WHERE id = ?").run(
    sshUrl,
    appId
  );

  return NextResponse.json({
    message: result.message,
    ssh_url: sshUrl,
  });
}
