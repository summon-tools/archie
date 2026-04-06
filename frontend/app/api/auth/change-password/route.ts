import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError, verifyPassword, hashPassword } from "@/lib/server/auth";
import type { UserRow } from "@/lib/server/types";
import { changePasswordSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: formatZodError(parsed.error) },
        { status: 400 }
      );
    }
    const { current_password, new_password } = parsed.data;

    const db = getDb();
    const dbUser = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(user.id) as UserRow;

    if (!verifyPassword(current_password, dbUser.password_hash)) {
      return NextResponse.json(
        { detail: "Current password is incorrect" },
        { status: 400 }
      );
    }

    const newHash = hashPassword(new_password);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      newHash,
      user.id
    );

    return NextResponse.json({ message: "Password changed successfully" });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
