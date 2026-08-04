import { NextRequest, NextResponse } from "next/server";
import { updateTaskSchema } from "@/lib/schemas/api";
import * as dal from "@/lib/server/dal";
import { serializeTask } from "@/lib/server/task-view";
import { handleRouteError, readJsonBody, requireTaskAccess, RouteInputError } from "@/lib/server/route-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; taskId: string }> },
) {
  try {
    const { task } = await requireTaskAccess(request, (await params).appId, (await params).taskId);
    return NextResponse.json(serializeTask(task));
  } catch (error) {
    const errorResponse = handleRouteError(error);
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

    const fields = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assigned_to !== undefined ? { assigned_to: input.assigned_to } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    };
    const updated = dal.updateTask(task.id, fields);
    return NextResponse.json(serializeTask(updated));
  } catch (error) {
    const errorResponse = handleRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
