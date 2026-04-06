import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { updateNameSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const body = await request.json();
    const parsed = updateNameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: formatZodError(parsed.error) },
        { status: 400 }
      );
    }
    const { name } = parsed.data;

    const db = getDb();
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(
      name,
      user.id
    );

    return NextResponse.json({ message: "Name updated", name });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
