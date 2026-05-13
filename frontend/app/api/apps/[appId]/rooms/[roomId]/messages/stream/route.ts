import { NextRequest, NextResponse } from "next/server";
import { isHomeAgentKey } from "@/lib/home/agents";
import * as dal from "@/lib/server/dal";
import { createRoomAgentReplyStream } from "@/lib/server/room-agents";
import { handleRoomRouteError, readJsonBody, requireRoomAccess, serializeRoomPlan } from "@/lib/server/room-route-utils";

function streamEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { user: authUser, app, room } = await requireRoomAccess(request, appId, roomId);

    if (room.status !== "open") {
      return NextResponse.json({ detail: "Room is closed" }, { status: 409 });
    }

    const body = await readJsonBody(request);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ detail: "content is required" }, { status: 400 });
    }

    const targetAgentKey = typeof body.target_agent_key === "string" ? body.target_agent_key : null;
    if (targetAgentKey && !isHomeAgentKey(targetAgentKey)) {
      return NextResponse.json({ detail: "Unknown agent tag" }, { status: 400 });
    }

    const userMessage = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      kind: "message",
      body_md: content,
      author_user_id: authUser.id,
      payload_json: targetAgentKey ? JSON.stringify({ target_agent_key: targetAgentKey }) : null,
    });

    const encoder = new TextEncoder();

    return new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        let controllerOpen = true;
        const send = (event: string, data: unknown) => {
          if (!controllerOpen) return;
          try {
            controller.enqueue(encoder.encode(streamEvent(event, data)));
          } catch {
            controllerOpen = false;
          }
        };

        send("message", userMessage);
        send("status", { status: "running" });

        try {
          const reply = await createRoomAgentReplyStream({
            app,
            room,
            userMessage,
            callbacks: {
              onText: (text) => send("text", { text }),
              onActivity: (activity) => send("activity", activity),
              onStatus: (message) => send("activity", { kind: "status", message }),
              onPlanUpdated: (payload) => send("plan_updated", {
                ...payload,
                plan: serializeRoomPlan(room.id),
              }),
            },
          });

          send("message", reply);
          send("status", { status: "completed" });
          send("done", { message_id: reply.id });
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Unknown room agent error";
          const errorMessage = dal.createRoomMessage({
            room_id: room.id,
            role: "agent",
            agent_key: "coordinator",
            kind: "error",
            body_md: "I saved your message, but the room agent could not complete the reply. Try again in a moment.",
            payload_json: JSON.stringify({ error: detail }),
          });
          send("message", errorMessage);
          send("error", { error: "Room agent failed", detail });
          send("done", { message_id: errorMessage.id });
        } finally {
          controllerOpen = false;
          try { controller.close(); } catch {}
        }
      },
    }), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
