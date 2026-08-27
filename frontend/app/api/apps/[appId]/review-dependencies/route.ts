import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { requireProjectReviewMaintainer } from "@/lib/server/review-authorization";
import { projectReviewDependencySchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

function idFrom(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function auth(request: NextRequest, appId: number): Promise<NextResponse | null> {
  try {
    const authorized = await requireProjectReviewMaintainer(request, appId);
    return authorized ? null : NextResponse.json({ detail: "App not found" }, { status: 404 });
  }
  catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ detail: error.message }, { status: 403 });
    throw error;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const appId = idFrom((await params).appId);
  if (!appId) return NextResponse.json({ detail: "Invalid app ID" }, { status: 400 });
  const error = await auth(request, appId); if (error) return error;
  return NextResponse.json({ dependencies: dal.listProjectDependencies(appId) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const appId = idFrom((await params).appId);
  if (!appId) return NextResponse.json({ detail: "Invalid app ID" }, { status: 400 });
  const error = await auth(request, appId); if (error) return error;
  const parsed = projectReviewDependencySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ detail: formatZodError(parsed.error) }, { status: 400 });
  if (parsed.data.provider_app_id === appId) return NextResponse.json({ detail: "A project cannot depend on itself" }, { status: 400 });
  if (!dal.getApp(parsed.data.provider_app_id)) return NextResponse.json({ detail: "Provider project not found" }, { status: 404 });
  try {
    return NextResponse.json(dal.createProjectDependency({ consumer_app_id: appId, ...parsed.data }), { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to create project dependency";
    return NextResponse.json({ detail }, { status: detail.includes("UNIQUE") ? 409 : 500 });
  }
}
