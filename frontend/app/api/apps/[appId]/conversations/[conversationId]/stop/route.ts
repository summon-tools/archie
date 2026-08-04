import { NextRequest, NextResponse } from "next/server";
import { stopConversation } from "@/lib/server/conversation";
import { handleRouteError, requireConversationAccess } from "@/lib/server/route-utils";

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
    const errorResponse = handleRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
