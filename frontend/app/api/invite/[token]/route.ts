import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import type { InvitationRow } from "@/lib/server/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const db = getDb();
  const invitation = db
    .prepare("SELECT * FROM invitations WHERE token = ?")
    .get(token) as InvitationRow | undefined;

  if (!invitation) {
    return NextResponse.json(
      { detail: "Invitation not found" },
      { status: 404 }
    );
  }

  if (invitation.accepted_at) {
    return NextResponse.json(
      { detail: "Invitation has already been used" },
      { status: 410 }
    );
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json(
      { detail: "Invitation has expired" },
      { status: 410 }
    );
  }

  return NextResponse.json({
    email: invitation.email,
    expires_at: invitation.expires_at,
  });
}
