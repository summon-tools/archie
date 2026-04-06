import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import {
  hashPassword,
  createToken,
  isSecureRequest,
  buildCookieOptions,
} from "@/lib/server/auth";
import { randomAvatarColor } from "@/lib/server/avatarColors";
import type { InvitationRow } from "@/lib/server/types";
import { inviteAcceptSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json();
  const parsed = inviteAcceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: formatZodError(parsed.error) },
      { status: 400 }
    );
  }
  const { name, password } = parsed.data;

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

  // Create user (email from invitation, uniqueness enforced by DB index)
  const passwordHash = hashPassword(password);
  const color = randomAvatarColor();
  const result = db
    .prepare(
      "INSERT INTO users (username, name, password_hash, role, email, color) VALUES (?, ?, ?, 'member', ?, ?)"
    )
    .run(name, name, passwordHash, invitation.email, color);
  const userId = result.lastInsertRowid as number;

  // Mark invitation as accepted
  db.prepare(
    "UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?"
  ).run(invitation.id);

  // Create JWT and set cookie
  const jwt = await createToken(userId, name, "member");
  const secure = isSecureRequest(request);
  const cookieOpts = buildCookieOptions(secure);

  const response = NextResponse.json({
    message: "Account created",
    name,
  });
  response.cookies.set(cookieOpts.name, jwt, {
    httpOnly: cookieOpts.httpOnly,
    sameSite: cookieOpts.sameSite,
    secure: cookieOpts.secure,
    maxAge: cookieOpts.maxAge,
    path: cookieOpts.path,
  });
  return response;
}
