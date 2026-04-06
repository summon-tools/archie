import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

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

    return NextResponse.json({ message: "ok" });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
