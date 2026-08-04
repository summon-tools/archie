import { NextRequest, NextResponse } from "next/server";
import { getConversationStatus } from "@/lib/server/conversation";
import { handleRouteError, requireConversationAccess } from "@/lib/server/route-utils";

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
    const errorResponse = handleRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
