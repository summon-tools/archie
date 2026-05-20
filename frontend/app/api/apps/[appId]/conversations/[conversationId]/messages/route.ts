import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { emitConversationEvent } from "@/lib/server/conversation-events";
import { getConversationMessages } from "@/lib/server/conversation";
import { serializeAppFile } from "@/lib/server/file-storage";
import { handleRoomRouteError, parseFileIds, readJsonBody, requireAvailableAppFiles, requireConversationAccess } from "@/lib/server/room-route-utils";
import type { MessageRow } from "@/lib/server/types";

type MessageRole = MessageRow["role"];

function parseMessageRole(value: unknown): MessageRole {
  return value === "assistant" || value === "system" || value === "user" ? value : "user";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    const access = await requireConversationAccess(request, appId, conversationId);

    const messages = getConversationMessages(access.conversation.id);

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        role: m.role,
        content: m.content,
        message_type: m.message_type,
        created_by_name: m.created_by_name,
        created_by_color: m.created_by_color,
        sender_label: m.sender_label,
        created_at: m.created_at,
        attachments: dal.getFilesForMessage(access.app.id, m.id).map(serializeAppFile),
      })),
    });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    const access = await requireConversationAccess(request, appId, conversationId);

    const body = await readJsonBody(request);
    const { content, role, message_type, mode } = body;
    const fileIds = parseFileIds(body.file_ids);

    if ((!content || typeof content !== "string") && fileIds.length === 0) {
      return NextResponse.json(
        { detail: "content is required" },
        { status: 400 }
      );
    }
    requireAvailableAppFiles(access.app.id, fileIds);

    const parsedRole = parseMessageRole(role);
    const parsedMessageType = typeof message_type === "string" ? message_type : "text";
    const bodyMd = typeof content === "string" ? content : "";
    const message = dal.createMessage({
      conversation_id: access.conversation.id,
      role: parsedRole,
      kind: parsedMessageType,
      author_user_id: access.user.id,
      body_md: bodyMd,
    });
    dal.linkAppFiles({
      app_id: access.app.id,
      file_ids: fileIds,
      conversation_id: access.conversation.id,
      message_id: message.id,
      link_type: "attachment",
    });
    const attachments = dal.getFilesForMessage(access.app.id, message.id).map(serializeAppFile);

    emitConversationEvent(access.conversation.id, {
      type: "message",
      message: {
        id: message.id,
        conversation_id: access.conversation.id,
        role: parsedRole,
        content: bodyMd,
        message_type: parsedMessageType,
        created_by_name: access.user.name || null,
        created_by_color: null,
        sender_label: access.user.name || null,
        created_at: message.created_at,
        attachments,
      },
    });

    return NextResponse.json({ ...message, attachments });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
