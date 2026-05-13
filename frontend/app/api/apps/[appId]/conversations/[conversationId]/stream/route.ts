import { NextRequest, NextResponse } from "next/server";
import { streamConversationMessage } from "@/lib/server/conversation";
import { handleRoomRouteError, readJsonBody, requireConversationAccess } from "@/lib/server/room-route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    const access = await requireConversationAccess(request, appId, conversationId);

    const body = await readJsonBody(request);
    const { content, model, provider, retry } = body;

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { detail: "content is required" },
        { status: 400 }
      );
    }

    const stream = await streamConversationMessage(
      access.conversation.id,
      content,
      access.app.name,
      access.app.directory,
      typeof model === "string" ? model : undefined,
      access.user.id,
      !!retry,
      typeof provider === "string" ? provider : undefined
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    if (e instanceof Error && e.message.includes("already running")) {
      return NextResponse.json({ detail: e.message }, { status: 409 });
    }
    throw e;
  }
}
