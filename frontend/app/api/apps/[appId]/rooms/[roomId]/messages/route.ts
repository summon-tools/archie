import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { createCoordinatorRoomReply } from "@/lib/server/room-agents";
import { DEFAULT_HOME_AGENTS } from "@/lib/home/agents";

function getRoomForApp(appId: number, roomId: number) {
  const app = dal.getApp(appId);
  if (!app) return { error: NextResponse.json({ detail: "App not found" }, { status: 404 }) };

  const room = dal.getRoom(roomId);
  if (!room || room.app_id !== app.id) {
    return { error: NextResponse.json({ detail: "Room not found" }, { status: 404 }) };
  }

  return { app, room };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId } = await params;
    const result = getRoomForApp(Number(appId), Number(roomId));
    if (result.error) return result.error;

    return NextResponse.json({ messages: dal.getRoomMessages(result.room!.id) });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const authUser = await getAuthUser(request);
    const { appId, roomId } = await params;
    const result = getRoomForApp(Number(appId), Number(roomId));
    if (result.error) return result.error;

    const body = await request.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ detail: "content is required" }, { status: 400 });
    }
    const targetAgentKey = typeof body.target_agent_key === "string" ? body.target_agent_key : null;
    if (targetAgentKey && !DEFAULT_HOME_AGENTS.some((agent) => agent.key === targetAgentKey)) {
      return NextResponse.json({ detail: "Unknown agent tag" }, { status: 400 });
    }

    const message = dal.createRoomMessage({
      room_id: result.room!.id,
      role: "user",
      kind: "message",
      body_md: content,
      author_user_id: authUser.id,
      payload_json: targetAgentKey ? JSON.stringify({ target_agent_key: targetAgentKey }) : null,
    });

    void createCoordinatorRoomReply({
      app: result.app!,
      room: result.room!,
      userMessage: message,
    });

    return NextResponse.json(message, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
