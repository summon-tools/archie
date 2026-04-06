import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

/**
 * POST /api/notifications/{id}/read — mark a single notification as read.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id } = await params;

    const notification = dal.getNotification(Number(id));
    if (!notification) {
      return NextResponse.json({ detail: "Notification not found" }, { status: 404 });
    }

    // Only the recipient can mark their own notification as read
    if (notification.recipient_user_id && notification.recipient_user_id !== user.id) {
      return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
    }

    dal.markNotificationRead(notification.id);
    const updated = dal.getNotification(notification.id);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
