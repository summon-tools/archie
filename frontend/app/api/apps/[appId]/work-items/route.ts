import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { enrichWorkItem } from "@/lib/server/work-item-view";
import { handleRoomRouteError, parseFileIds, readJsonBody, requireAppAccess, requireAvailableAppFiles } from "@/lib/server/room-route-utils";
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
    const fileIds = parseFileIds(body.file_ids);
    if ((!message || typeof message !== "string") && fileIds.length === 0) {
      return NextResponse.json({ detail: "message is required" }, { status: 400 });
    }
    requireAvailableAppFiles(access.app.id, fileIds);

    const taskType = parseWorkItemKind(body.task_type);
    const bodyMd = typeof message === "string" ? message : "";
    let taskId = body.task_id === undefined || body.task_id === null ? null : Number(body.task_id);
    if (taskId !== null && (!Number.isInteger(taskId) || taskId <= 0)) {
      return NextResponse.json({ detail: "task_id must be a positive integer" }, { status: 400 });
    }
    if (taskId !== null) {
      const task = dal.getTask(taskId);
      if (!task || task.app_id !== access.app.id) {
        return NextResponse.json({ detail: "Task not found" }, { status: 404 });
      }
    }

    // Auto-generate title from message
    const titleSource = bodyMd.trim() || "File attachment task";
    const title = titleSource.length > 60
      ? titleSource.slice(0, 60) + "..."
      : titleSource;

    // The existing "create and start" flow remains available, but it now
    // creates the planning record as well so every user-started task can be
    // found on the task board later.
    if (taskId === null && taskType === "task") {
      const task = dal.createTask({
        app_id: access.app.id,
        title,
        description: bodyMd,
        status: "in_progress",
        created_by: access.user.id,
      });
      taskId = task.id;
    }

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
      summary: bodyMd,
      kind: taskType,
      created_by: access.user.id,
    });

    // Add the initial user message to the conversation
    const initialMessage = dal.createMessage({
      conversation_id: conversation.id,
      role: "user",
      author_user_id: access.user.id,
      body_md: bodyMd,
    });
    dal.linkAppFiles({
      app_id: access.app.id,
      file_ids: fileIds,
      conversation_id: conversation.id,
      message_id: initialMessage.id,
      work_item_id: workItem.id,
      link_type: "attachment",
    });
    if (taskId !== null) {
      dal.linkTaskToWorkItem(taskId, workItem.id);
      dal.updateTask(taskId, { status: "in_progress" });
    }

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
