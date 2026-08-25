import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { updateAppDependencySchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

async function authenticate(request: NextRequest): Promise<NextResponse | null> {
  try {
    await getAuthUser(request);
    return null;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    throw error;
  }
}

function parseId(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; dependencyId: string }> },
) {
  const authError = await authenticate(request);
  if (authError) return authError;

  const { appId: appIdValue, dependencyId: dependencyIdValue } = await params;
  const appId = parseId(appIdValue);
  const dependencyId = parseId(dependencyIdValue);
  if (!appId || !dependencyId) return NextResponse.json({ detail: "Invalid dependency ID" }, { status: 400 });
  if (!dal.getApp(appId)) return NextResponse.json({ detail: "App not found" }, { status: 404 });
  if (!dal.getAppDependency(appId, dependencyId)) return NextResponse.json({ detail: "Project dependency not found" }, { status: 404 });

  const parsed = updateAppDependencySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ detail: formatZodError(parsed.error) }, { status: 400 });

  try {
    const dependency = dal.updateAppDependency(appId, dependencyId, parsed.data);
    return NextResponse.json(dependency);
  } catch (error: any) {
    return NextResponse.json({ detail: error?.message || "Failed to update project dependency" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; dependencyId: string }> },
) {
  const authError = await authenticate(request);
  if (authError) return authError;

  const { appId: appIdValue, dependencyId: dependencyIdValue } = await params;
  const appId = parseId(appIdValue);
  const dependencyId = parseId(dependencyIdValue);
  if (!appId || !dependencyId) return NextResponse.json({ detail: "Invalid dependency ID" }, { status: 400 });
  if (!dal.getApp(appId)) return NextResponse.json({ detail: "App not found" }, { status: 404 });
  if (!dal.deleteAppDependency(appId, dependencyId)) return NextResponse.json({ detail: "Project dependency not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
