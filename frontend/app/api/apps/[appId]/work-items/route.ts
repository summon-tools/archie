import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { enrichWorkItem } from "@/lib/server/work-item-view";
import { handleRoomRouteError, readJsonBody, requireAppAccess } from "@/lib/server/room-route-utils";
import type { WorkItemKind } from "@/lib/server/types";

function parseWorkItemKind(value: unknown): WorkItemKind {
  return value === "setup" ? "setup" : "task";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId } = await params;
    const access = await requireAppAccess(request, appId);

    const items = dal.getWorkItemsByApp(access.app.id);
    const workItems = items.map((wi) => {
      try { return enrichWorkItem(wi); } catch { return { ...wi, description: wi.summary }; }
    });

    return NextResponse.json({ work_items: workItems });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId } = await params;
    const access = await requireAppAccess(request, appId);

    const body = await readJsonBody(request);
    const message = body.message;
    if (!message || typeof message !== "string") {
      return NextResponse.json({ detail: "message is required" }, { status: 400 });
    }

    const taskType = parseWorkItemKind(body.task_type);

    // Auto-generate title from message
    const title = message.length > 60
      ? message.slice(0, 60) + "..."
      : message;

    // Create conversation first
    const conversation = dal.createConversation({
      app_id: access.app.id,
      kind: "task",
      title,
      created_by: access.user.id,
    });

    // Create work item pointing to conversation
    const workItem = dal.createWorkItem({
      app_id: access.app.id,
      primary_conversation_id: conversation.id,
      title,
      summary: message,
      kind: taskType,
      created_by: access.user.id,
    });

    // Add the initial user message to the conversation
    dal.createMessage({
      conversation_id: conversation.id,
      role: "user",
      author_user_id: access.user.id,
      body_md: message,
    });

    const enriched = enrichWorkItem({
      ...workItem,
      created_by_name: access.user.name,
      created_by_color: (access.user as any).color || null,
    });

    return NextResponse.json(enriched, { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
