import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";
import { setupSshKey } from "@/lib/server/git";

export async function POST(request: NextRequest) {
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

  const result = setupSshKey();

  if (!result.success) {
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  return NextResponse.json({
    message: result.message,
    public_key: result.public_key,
  });
}
