import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { createAppDependencySchema } from "@/lib/schemas/api";
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const authError = await authenticate(request);
  if (authError) return authError;

  const appId = parseId((await params).appId);
  if (!appId) return NextResponse.json({ detail: "Invalid app ID" }, { status: 400 });
  if (!dal.getApp(appId)) return NextResponse.json({ detail: "App not found" }, { status: 404 });
  return NextResponse.json({ dependencies: dal.listAppDependencies(appId) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const authError = await authenticate(request);
  if (authError) return authError;

  const appId = parseId((await params).appId);
  if (!appId) return NextResponse.json({ detail: "Invalid app ID" }, { status: 400 });
  if (!dal.getApp(appId)) return NextResponse.json({ detail: "App not found" }, { status: 404 });

  const parsed = createAppDependencySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ detail: formatZodError(parsed.error) }, { status: 400 });
  if (parsed.data.dependency_app_id === appId) {
    return NextResponse.json({ detail: "A project cannot depend on itself" }, { status: 400 });
  }
  if (!dal.getApp(parsed.data.dependency_app_id)) {
    return NextResponse.json({ detail: "Dependency project not found" }, { status: 404 });
  }

  try {
    const dependency = dal.createAppDependency({ app_id: appId, ...parsed.data });
    return NextResponse.json(dependency, { status: 201 });
  } catch (error: any) {
    if (String(error?.message || "").includes("UNIQUE constraint failed")) {
      return NextResponse.json({ detail: "This project dependency already exists" }, { status: 409 });
    }
    return NextResponse.json({ detail: error?.message || "Failed to add project dependency" }, { status: 500 });
  }
}
