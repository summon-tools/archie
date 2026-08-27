import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { requireProjectReviewMaintainer } from "@/lib/server/review-authorization";
import { updateProjectReviewDependencySchema } from "@/lib/schemas/api";
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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ appId: string; dependencyId: string }> }) {
  const values = await params;
  const appId = idFrom(values.appId); const dependencyId = idFrom(values.dependencyId);
  if (!appId || !dependencyId) return NextResponse.json({ detail: "Invalid dependency ID" }, { status: 400 });
  const error = await auth(request, appId); if (error) return error;
  const dependency = dal.getProjectDependency(dependencyId);
  if (!dependency || dependency.consumer_app_id !== appId) return NextResponse.json({ detail: "Project dependency not found" }, { status: 404 });
  const parsed = updateProjectReviewDependencySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ detail: formatZodError(parsed.error) }, { status: 400 });
  if (parsed.data.provider_app_id !== undefined && parsed.data.provider_app_id !== dependency.provider_app_id) {
    return NextResponse.json({ detail: "Provider project cannot be changed; create a new dependency instead" }, { status: 400 });
  }
  const { provider_app_id: _providerAppId, ...editable } = parsed.data;
  const updated = dal.updateProjectDependency(dependencyId, editable);
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ appId: string; dependencyId: string }> }) {
  const values = await params;
  const appId = idFrom(values.appId); const dependencyId = idFrom(values.dependencyId);
  if (!appId || !dependencyId) return NextResponse.json({ detail: "Invalid dependency ID" }, { status: 400 });
  const error = await auth(request, appId); if (error) return error;
  const dependency = dal.getProjectDependency(dependencyId);
  if (!dependency || dependency.consumer_app_id !== appId) return NextResponse.json({ detail: "Project dependency not found" }, { status: 404 });
  dal.deleteProjectDependency(dependencyId);
  return NextResponse.json({ success: true });
}
