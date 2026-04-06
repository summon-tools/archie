import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getDb } from "@/lib/server/db";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";
import type { InvitationRow } from "@/lib/server/types";
import { createInvitationSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

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
  const invitations = db
    .prepare("SELECT * FROM invitations ORDER BY created_at DESC")
    .all() as InvitationRow[];

  return NextResponse.json({ invitations });
}

export async function POST(request: NextRequest) {
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

  const body = await request.json();
  const parsed = createInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: formatZodError(parsed.error) },
      { status: 400 }
    );
  }
  const { email } = parsed.data;

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48);

  const db = getDb();
  const result = db
    .prepare(
      "INSERT INTO invitations (email, token, invited_by, expires_at) VALUES (?, ?, ?, ?)"
    )
    .run(email.trim(), token, admin.id, expiresAt.toISOString());

  return NextResponse.json(
    {
      id: result.lastInsertRowid as number,
      email: email.trim(),
      token,
      expires_at: expiresAt.toISOString(),
    },
    { status: 201 }
  );
}
