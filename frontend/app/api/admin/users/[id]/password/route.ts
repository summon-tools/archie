import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { requireAdmin, AuthError, ForbiddenError, hashPassword } from "@/lib/server/auth";
import { adminResetUserPasswordSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";
import type { UserRow } from "@/lib/server/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let admin;
  try {
    admin = await requireAdmin(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ detail: e.message }, { status: 403 });
    }
    throw e;
  }

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) {
    return NextResponse.json({ detail: "Invalid user ID" }, { status: 400 });
  }

  if (userId === admin.id) {
    return NextResponse.json(
      { detail: "Use your profile page to change your own password" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = adminResetUserPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: formatZodError(parsed.error) },
      { status: 400 }
    );
  }

  const db = getDb();
  const user = db
    .prepare("SELECT id, deleted_at FROM users WHERE id = ? AND username != '__archie_automation__'")
    .get(userId) as Pick<UserRow, "id" | "deleted_at"> | undefined;

  if (!user) {
    return NextResponse.json({ detail: "User not found" }, { status: 404 });
  }

  if (user.deleted_at) {
    return NextResponse.json(
      { detail: "Cannot reset password for a removed user" },
      { status: 400 }
    );
  }

  const passwordHash = hashPassword(parsed.data.new_password);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    passwordHash,
    userId
  );

  return NextResponse.json({ message: "Password reset" });
}
