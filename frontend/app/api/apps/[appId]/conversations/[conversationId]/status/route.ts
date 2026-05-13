import { NextRequest, NextResponse } from "next/server";
import { getConversationStatus } from "@/lib/server/conversation";
import { handleRoomRouteError, requireConversationAccess } from "@/lib/server/room-route-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    const access = await requireConversationAccess(request, appId, conversationId);

    const status = getConversationStatus(access.conversation.id);

    return NextResponse.json(status);
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
