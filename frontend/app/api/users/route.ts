import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import type { UserRow } from "@/lib/server/types";

/**
 * GET /api/users — list active team members (name + id only).
 * Requires authentication but not admin. Used by the project owner picker in
 * AppSettingsPanel so that non-admin members can assign a project owner.
 */
export async function GET(request: NextRequest) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }

  const users = getDb()
    .prepare(
      "SELECT id, name FROM users WHERE username != '__archie_automation__' AND deleted_at IS NULL ORDER BY id"
    )
    .all() as Pick<UserRow, "id" | "name">[];

  return NextResponse.json({ users });
}
