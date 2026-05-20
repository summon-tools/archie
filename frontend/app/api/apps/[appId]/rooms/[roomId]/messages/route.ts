import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { createRoomAgentReply } from "@/lib/server/room-agents";
import { isHomeAgentKey } from "@/lib/home/agents";
import { serializeAppFile } from "@/lib/server/file-storage";
import { handleRoomRouteError, parseFileIds, readJsonBody, requireAvailableAppFiles, requireRoomAccess } from "@/lib/server/room-route-utils";
import type { RoomMessageRow } from "@/lib/server/types";

function serializeRoomMessage(appId: number, message: RoomMessageRow) {
  const author = message.author_user_id && message.author_name === undefined
    ? dal.getUser(message.author_user_id)
    : null;
  return {
    ...message,
    created_by_name: message.author_name ?? author?.name ?? null,
    created_by_color: message.author_color ?? author?.color ?? null,
    attachments: dal.getFilesForRoomMessage(appId, message.id).map(serializeAppFile),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { room } = await requireRoomAccess(request, appId, roomId);

    return NextResponse.json({
      messages: dal.getRoomMessages(room.id).map((message) => serializeRoomMessage(room.app_id, message)),
    });
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
    const fileIds = parseFileIds(body.file_ids);
    if (!content && fileIds.length === 0) {
      return NextResponse.json({ detail: "content is required" }, { status: 400 });
    }
    requireAvailableAppFiles(app.id, fileIds);
    const targetAgentKey = typeof body.target_agent_key === "string" ? body.target_agent_key : null;
    if (targetAgentKey && !isHomeAgentKey(targetAgentKey)) {
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
    dal.linkAppFiles({
      app_id: app.id,
      file_ids: fileIds,
      room_id: room.id,
      room_message_id: message.id,
      link_type: "attachment",
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

    return NextResponse.json(serializeRoomMessage(app.id, message), { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
