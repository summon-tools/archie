import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";
import type { UserRow } from "@/lib/server/types";

export async function GET(request: NextRequest) {
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

  const db = getDb();
  const users = db
    .prepare("SELECT id, name, email, role, color, deleted_at, created_at FROM users WHERE username != '__archie_automation__' ORDER BY deleted_at IS NOT NULL, id")
    .all() as Omit<UserRow, "password_hash" | "username">[];

  return NextResponse.json({ users });
}
