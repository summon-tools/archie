import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { deleteEnvVar } from "@/lib/server/env";
import type { AppRow } from "@/lib/server/types";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; key: string }> }
) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  const { appId, key } = await params;

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

  const result = deleteEnvVar(app.directory, key);

  if (!result.success) {
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  return NextResponse.json({ message: `Environment variable '${key}' deleted` });
}
