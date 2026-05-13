import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { emitConversationEvent } from "@/lib/server/conversation-events";
import { getConversationMessages } from "@/lib/server/conversation";
import { handleRoomRouteError, readJsonBody, requireConversationAccess } from "@/lib/server/room-route-utils";
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
        created_at: m.created_at,
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

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { detail: "content is required" },
        { status: 400 }
      );
    }

    const parsedRole = parseMessageRole(role);
    const parsedMessageType = typeof message_type === "string" ? message_type : "text";
    const message = dal.createMessage({
      conversation_id: access.conversation.id,
      role: parsedRole,
      kind: parsedMessageType,
      author_user_id: access.user.id,
      body_md: content,
    });

    emitConversationEvent(access.conversation.id, {
      type: "message",
      message: { id: message.id, conversation_id: access.conversation.id, role: parsedRole, content, message_type: parsedMessageType, created_by_name: access.user.name || null, created_by_color: null, created_at: message.created_at },
    });

    return NextResponse.json(message);
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
