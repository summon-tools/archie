import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

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

    return NextResponse.json(conversation);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function PUT(
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

    const body = await request.json();
    const fields: Record<string, unknown> = {};
    if (body.title !== undefined) fields.title = body.title;
    if (body.status !== undefined) fields.status = body.status;

    dal.updateConversation(Number(conversationId), fields);

    const updated = dal.getConversation(Number(conversationId));
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function DELETE(
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

    dal.deleteConversation(Number(conversationId));

    return NextResponse.json({ message: "Conversation deleted" });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
