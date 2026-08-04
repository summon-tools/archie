import { NextRequest, NextResponse } from "next/server";
import { createTaskSchema } from "@/lib/schemas/api";
import * as dal from "@/lib/server/dal";
import { serializeTask } from "@/lib/server/task-view";
import { handleRoomRouteError, readJsonBody, requireAppAccess, RouteInputError } from "@/lib/server/room-route-utils";

function parseTaskInput(body: Record<string, unknown>) {
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw new RouteInputError(parsed.error.issues[0]?.message || "Invalid task");
  }
  return parsed.data;
}

function assertTaskProject(taskId: number | null | undefined, appId: number, fieldName: string): void {
  if (taskId === null || taskId === undefined) return;
  const task = dal.getTask(taskId);
  if (!task || task.app_id !== appId) throw new RouteInputError(`${fieldName} must belong to this project`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const { app } = await requireAppAccess(request, (await params).appId);
    return NextResponse.json({ tasks: dal.getTasksByApp(app.id).map(serializeTask) });
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const { user, app } = await requireAppAccess(request, (await params).appId);
    const input = parseTaskInput(await readJsonBody(request));
    assertTaskProject(input.parent_task_id, app.id, "parent_task_id");

    const task = dal.createTask({
      app_id: app.id,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      parent_task_id: input.parent_task_id,
      assigned_to: input.assigned_to,
      created_by: user.id,
    });
    try {
      dal.setTaskDependencies(task.id, input.dependency_ids);
    } catch (error) {
      dal.deleteTask(task.id);
      throw new RouteInputError(error instanceof Error ? error.message : "Invalid task dependencies");
    }

    return NextResponse.json(serializeTask({ ...task, created_by_name: user.name, created_by_color: (user as any).color || null }), { status: 201 });
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
