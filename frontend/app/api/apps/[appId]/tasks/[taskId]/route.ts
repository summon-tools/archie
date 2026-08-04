import { NextRequest, NextResponse } from "next/server";
import { updateTaskSchema } from "@/lib/schemas/api";
import * as dal from "@/lib/server/dal";
import { serializeTask } from "@/lib/server/task-view";
import { handleRoomRouteError, readJsonBody, requireTaskAccess, RouteInputError } from "@/lib/server/room-route-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; taskId: string }> },
) {
  try {
    const { task } = await requireTaskAccess(request, (await params).appId, (await params).taskId);
    return NextResponse.json(serializeTask(task));
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; taskId: string }> },
) {
  try {
    const routeParams = await params;
    const { task, app } = await requireTaskAccess(request, routeParams.appId, routeParams.taskId);
    const parsed = updateTaskSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new RouteInputError(parsed.error.issues[0]?.message || "Invalid task update");
    const input = parsed.data;

    if (input.parent_task_id === task.id || (input.parent_task_id && (!dal.getTask(input.parent_task_id) || dal.getTask(input.parent_task_id)!.app_id !== app.id))) {
      throw new RouteInputError("parent_task_id must belong to this project and cannot be the task itself");
    }
    if (input.parent_task_id !== undefined && dal.wouldCreateParentCycle(task.id, input.parent_task_id)) {
      throw new RouteInputError("Task hierarchy cannot contain a cycle");
    }

    const fields = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.parent_task_id !== undefined ? { parent_task_id: input.parent_task_id } : {}),
      ...(input.assigned_to !== undefined ? { assigned_to: input.assigned_to } : {}),
      ...(input.blocked_reason !== undefined ? { blocked_reason: input.blocked_reason } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    };
    if (input.dependency_ids !== undefined) {
      try {
        dal.setTaskDependencies(task.id, input.dependency_ids);
      } catch (error) {
        throw new RouteInputError(error instanceof Error ? error.message : "Invalid task dependencies");
      }
    }
    const updated = dal.updateTask(task.id, fields);
    return NextResponse.json(serializeTask(updated));
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
