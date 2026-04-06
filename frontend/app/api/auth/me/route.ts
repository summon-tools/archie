import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    return NextResponse.json({
      name: user.name,
      role: user.role,
      email: user.email,
      color: user.color,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
