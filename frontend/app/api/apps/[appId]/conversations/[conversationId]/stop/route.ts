import { NextRequest, NextResponse } from "next/server";
import { stopConversation } from "@/lib/server/conversation";
import { handleRoomRouteError, requireConversationAccess } from "@/lib/server/room-route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    const access = await requireConversationAccess(request, appId, conversationId);

    stopConversation(access.conversation.id);

    return NextResponse.json({ message: "Conversation stopped" });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
