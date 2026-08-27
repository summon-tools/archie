import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireAdmin } from "@/lib/server/auth";
import { GitHubAppError, listGitHubAppInstallations } from "@/lib/server/github-app";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json({ installations: await listGitHubAppInstallations() });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ detail: error.message }, { status: 403 });
    if (error instanceof GitHubAppError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Failed to list GitHub App installations" }, { status: 500 });
  }
}
