import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

/**
 * POST /api/notifications/read-all — mark all notifications as read.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const body = await request.json().catch(() => ({}));
    const appId = body.app_id ? Number(body.app_id) : undefined;

    dal.markAllRead(user.id, appId);
    const unread_count = dal.getUnreadCount(user.id, appId);
    return NextResponse.json({ message: "All notifications marked as read", unread_count });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
