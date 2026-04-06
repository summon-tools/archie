import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { stopConversation } from "@/lib/server/conversation";

export async function POST(
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

    stopConversation(Number(conversationId));

    return NextResponse.json({ message: "Conversation stopped" });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
