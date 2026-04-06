import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

/**
 * GET /api/notifications — list notifications with optional filters.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || undefined;
    const appId = url.searchParams.get("app_id") ? Number(url.searchParams.get("app_id")) : undefined;

    const notifications = dal.getAllNotifications({
      status,
      appId,
      recipientUserId: user.id,
    });
    const unread_count = dal.getUnreadCount(user.id, appId);

    return NextResponse.json({ notifications, unread_count });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
