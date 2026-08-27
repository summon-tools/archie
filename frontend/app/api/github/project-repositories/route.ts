import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireAdmin } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { createGitHubProjectRepositorySchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json({ repositories: dal.listProjectRepositories() });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ detail: error.message }, { status: 403 });
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = createGitHubProjectRepositorySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ detail: formatZodError(parsed.error) }, { status: 400 });
    }
    if (!dal.getApp(parsed.data.app_id)) {
      return NextResponse.json({ detail: "Project not found" }, { status: 404 });
    }

    dal.upsertGitHubInstallation({
      installation_id: parsed.data.installation_id,
      account_login: parsed.data.account_login,
      account_type: parsed.data.account_type,
    });
    const repository = dal.upsertProjectRepository(parsed.data);
    return NextResponse.json(repository, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ detail: error.message }, { status: 403 });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Failed to map GitHub repository" }, { status: 500 });
  }
}
