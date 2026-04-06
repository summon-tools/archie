import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { streamConversationMessage } from "@/lib/server/conversation";

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
    const { content, model, provider, retry } = body;

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { detail: "content is required" },
        { status: 400 }
      );
    }

    const stream = await streamConversationMessage(
      Number(conversationId),
      content,
      app.name,
      app.directory,
      model || undefined,
      authUser.id,
      !!retry,
      provider || undefined
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof Error && e.message.includes("already running")) {
      return NextResponse.json({ detail: e.message }, { status: 409 });
    }
    throw e;
  }
}
