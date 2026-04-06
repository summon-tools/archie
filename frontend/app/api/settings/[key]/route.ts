import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { clearSettingsCache } from "@/lib/server/config";
import { clearProviderCache } from "@/lib/server/knowledge/preflight";
import { getAuthUser, requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  const { key } = await params;
  const value = dal.getSetting(key);
  return NextResponse.json({ key, value: value ?? null });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ detail: e.message }, { status: 403 });
    }
    throw e;
  }

  const { key } = await params;

  const deleted = dal.deleteSetting(key);
  clearSettingsCache();
  clearProviderCache();

  if (!deleted) {
    return NextResponse.json(
      { detail: `Setting '${key}' not found` },
      { status: 404 }
    );
  }

  return NextResponse.json({ message: `Setting '${key}' deleted` });
}
