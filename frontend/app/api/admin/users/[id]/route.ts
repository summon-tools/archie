import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";
import { patchUserSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

export async function PATCH(
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
      { detail: "Cannot change your own role" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = patchUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: formatZodError(parsed.error) },
      { status: 400 }
    );
  }

  const db = getDb();

  if ("restore" in parsed.data) {
    const result = db
      .prepare("UPDATE users SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL")
      .run(userId);
    if (result.changes === 0) {
      return NextResponse.json({ detail: "User not found or not deleted" }, { status: 404 });
    }
    return NextResponse.json({ message: "User restored" });
  }

  const { role } = parsed.data;

  const result = db
    .prepare("UPDATE users SET role = ? WHERE id = ?")
    .run(role, userId);

  if (result.changes === 0) {
    return NextResponse.json({ detail: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ message: "Role updated", role });
}

export async function DELETE(
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
      { detail: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  const db = getDb();
  const result = db
    .prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL")
    .run(userId);

  if (result.changes === 0) {
    return NextResponse.json({ detail: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ message: "User deleted" });
}
