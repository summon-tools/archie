import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { handleRoomRouteError, requireAppAccess } from "@/lib/server/room-route-utils";

/**
 * GET /api/apps/{appId}/conversations — list all conversations for an app (for sidebar)
 * Returns enriched conversation list with work item info.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId } = await params;
    const { app } = await requireAppAccess(request, appId);

    const conversations = dal.getConversationsForApp(app.id);
    return NextResponse.json(conversations);
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
