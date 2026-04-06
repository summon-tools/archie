import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

/**
 * GET /api/notifications/count — returns unread notification count.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const unread_count = dal.getUnreadCount(user.id);
    return NextResponse.json({ unread_count });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
