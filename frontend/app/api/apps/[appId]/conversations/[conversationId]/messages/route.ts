import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { emitConversationEvent } from "@/lib/server/conversation-events";
import { getConversationMessages } from "@/lib/server/conversation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, conversationId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const conversation = dal.getConversation(Number(conversationId));
    if (!conversation || conversation.app_id !== app.id) {
      return NextResponse.json({ detail: "Conversation not found" }, { status: 404 });
    }

    const messages = getConversationMessages(Number(conversationId));

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
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const authUser = await getAuthUser(request);
    const { appId, conversationId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const conversation = dal.getConversation(Number(conversationId));
    if (!conversation || conversation.app_id !== app.id) {
      return NextResponse.json({ detail: "Conversation not found" }, { status: 404 });
    }

    const body = await request.json();
    const { content, role, message_type, mode } = body;

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { detail: "content is required" },
        { status: 400 }
      );
    }

    const message = dal.createMessage({
      conversation_id: Number(conversationId),
      role: role || "user",
      kind: message_type || "text",
      author_user_id: authUser.id,
      body_md: content,
    });

    emitConversationEvent(Number(conversationId), {
      type: "message",
      message: { id: message.id, conversation_id: Number(conversationId), role: role || "user", content, message_type: message_type || "text", created_by_name: authUser.name || null, created_by_color: null, created_at: message.created_at },
    });

    return NextResponse.json(message);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
