import { NextRequest, NextResponse } from "next/server";
import { handleRouteError, requireConversationAccess } from "@/lib/server/route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    await requireConversationAccess(request, appId, conversationId);

    return NextResponse.json({ message: "ok" });
  } catch (e) {
    const errorResponse = handleRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
