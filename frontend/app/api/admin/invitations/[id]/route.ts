import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  const { id } = await params;
  const inviteId = parseInt(id, 10);
  if (isNaN(inviteId)) {
    return NextResponse.json(
      { detail: "Invalid invitation ID" },
      { status: 400 }
    );
  }

  const db = getDb();
  const result = db
    .prepare("DELETE FROM invitations WHERE id = ? AND accepted_at IS NULL")
    .run(inviteId);

  if (result.changes === 0) {
    return NextResponse.json(
      { detail: "Invitation not found or already accepted" },
      { status: 404 }
    );
  }

  return NextResponse.json({ message: "Invitation revoked" });
}
