import { NextRequest } from "next/server";
import * as dal from "@/lib/server/dal";
import { subscribeConversation, getEventSeq } from "@/lib/server/conversation-events";
import { getConversationMessages } from "@/lib/server/conversation";
import { serializeAppFile } from "@/lib/server/file-storage";
import { handleRoomRouteError, requireConversationAccess } from "@/lib/server/room-route-utils";

/**
 * GET /api/apps/[appId]/conversations/[conversationId]/events
 *
 * Long-lived SSE stream that pushes conversation events (new messages, status changes)
 * to connected clients. Replaces the 3s polling loop in useConversation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  const { appId, conversationId } = await params;
  let numericConversationId: number;
  let numericAppId: number;
  try {
    const access = await requireConversationAccess(request, appId, conversationId);
    numericConversationId = access.conversation.id;
    numericAppId = access.app.id;
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }

  // Check Last-Event-ID for reconnection
  const lastEventIdHeader = request.headers.get("Last-Event-ID");
  const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) : null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const enqueue = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Controller closed
        }
      };

      // If reconnecting with a stale Last-Event-ID (from before server restart),
      // send current messages as a snapshot so the client can resync
      if (lastEventId !== null && lastEventId > getEventSeq()) {
        // Stale ID — send snapshot
        const messages = getConversationMessages(numericConversationId);
        enqueue(`event: snapshot\ndata: ${JSON.stringify({ messages: messages.map(m => ({
          id: m.id, conversation_id: m.conversation_id, role: m.role, content: m.content,
          message_type: m.message_type, created_by_name: m.created_by_name,
          created_by_color: m.created_by_color, sender_label: m.sender_label,
          created_at: m.created_at,
          attachments: dal.getFilesForMessage(numericAppId, m.id).map(serializeAppFile),
        })) })}\n\n`);
      }

      // Send current status
      const session = dal.getSessionForConversation(numericConversationId);
      if (session?.status) {
        enqueue(`id: ${getEventSeq()}\nevent: status\ndata: ${JSON.stringify({ status: session.status })}\n\n`);
      }

      // Subscribe to live events
      const unsubscribe = subscribeConversation(numericConversationId, (event) => {
        enqueue(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(
          event.type === "message" ? event.message : { status: event.status }
        )}\n\n`);
      });

      // Keepalive every 15s
      const keepalive = setInterval(() => {
        enqueue(": keepalive\n\n");
      }, 15000);

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(keepalive);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
