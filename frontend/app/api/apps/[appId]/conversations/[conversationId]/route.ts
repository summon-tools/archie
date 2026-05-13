import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { handleRoomRouteError, readJsonBody, requireConversationAccess } from "@/lib/server/room-route-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    const { conversation } = await requireConversationAccess(request, appId, conversationId);

    return NextResponse.json(conversation);
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    const { conversation } = await requireConversationAccess(request, appId, conversationId);

    const body = await readJsonBody(request);
    const fields: Record<string, unknown> = {};
    if (body.title !== undefined) fields.title = body.title;
    if (body.status !== undefined) fields.status = body.status;

    dal.updateConversation(conversation.id, fields);

    const updated = dal.getConversation(conversation.id);
    return NextResponse.json(updated);
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    const { conversation } = await requireConversationAccess(request, appId, conversationId);

    dal.deleteConversation(conversation.id);

    return NextResponse.json({ message: "Conversation deleted" });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
