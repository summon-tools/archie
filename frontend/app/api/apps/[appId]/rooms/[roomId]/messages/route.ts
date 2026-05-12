import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { createRoomAgentReply } from "@/lib/server/room-agents";
import { DEFAULT_HOME_AGENTS } from "@/lib/home/agents";
import { handleRoomRouteError, readJsonBody, requireRoomAccess } from "@/lib/server/room-route-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { room } = await requireRoomAccess(request, appId, roomId);

    return NextResponse.json({ messages: dal.getRoomMessages(room.id) });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { user: authUser, app, room } = await requireRoomAccess(request, appId, roomId);

    const body = await readJsonBody(request);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ detail: "content is required" }, { status: 400 });
    }
    const targetAgentKey = typeof body.target_agent_key === "string" ? body.target_agent_key : null;
    if (targetAgentKey && !DEFAULT_HOME_AGENTS.some((agent) => agent.key === targetAgentKey)) {
      return NextResponse.json({ detail: "Unknown agent tag" }, { status: 400 });
    }

    const message = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      kind: "message",
      body_md: content,
      author_user_id: authUser.id,
      payload_json: targetAgentKey ? JSON.stringify({ target_agent_key: targetAgentKey }) : null,
    });

    void createRoomAgentReply({
      app,
      room,
      userMessage: message,
    }).catch((error) => {
      dal.createRoomMessage({
        room_id: room.id,
        role: "agent",
        agent_key: "coordinator",
        kind: "error",
        body_md: "I saved your message, but the room agent could not complete the reply. Try again in a moment.",
        payload_json: JSON.stringify({ error: error instanceof Error ? error.message : "Unknown room agent error" }),
      });
    });

    return NextResponse.json(message, { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
