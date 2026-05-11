import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { enrichWorkItem } from "@/lib/server/work-item-view";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const items = dal.getWorkItemsByApp(Number(appId));
    const workItems = items.map((wi) => {
      try { return enrichWorkItem(wi); } catch { return { ...wi, description: wi.summary }; }
    });

    return NextResponse.json({ work_items: workItems });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const authUser = await getAuthUser(request);
    const { appId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const body = await request.json();
    const message = body.message;
    if (!message || typeof message !== "string") {
      return NextResponse.json({ detail: "message is required" }, { status: 400 });
    }

    const taskType = body.task_type || null;

    // Auto-generate title from message
    const title = message.length > 60
      ? message.slice(0, 60) + "..."
      : message;

    // Create conversation first
    const conversation = dal.createConversation({
      app_id: Number(appId),
      kind: "task",
      title,
      created_by: authUser.id,
    });

    // Create work item pointing to conversation
    const kind = taskType && taskType !== "task" ? taskType : "task";
    const workItem = dal.createWorkItem({
      app_id: Number(appId),
      primary_conversation_id: conversation.id,
      title,
      summary: message,
      kind,
      created_by: authUser.id,
    });

    // Add the initial user message to the conversation
    dal.createMessage({
      conversation_id: conversation.id,
      role: "user",
      author_user_id: authUser.id,
      body_md: message,
    });

    const enriched = enrichWorkItem({
      ...workItem,
      created_by_name: authUser.name,
      created_by_color: (authUser as any).color || null,
    });

    return NextResponse.json(enriched, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
