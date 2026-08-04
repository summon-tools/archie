import { NextRequest, NextResponse } from "next/server";
import { createTaskSchema } from "@/lib/schemas/api";
import * as dal from "@/lib/server/dal";
import { serializeTask } from "@/lib/server/task-view";
import { handleRouteError, readJsonBody, requireAppAccess, RouteInputError } from "@/lib/server/route-utils";

function parseTaskInput(body: Record<string, unknown>) {
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw new RouteInputError(parsed.error.issues[0]?.message || "Invalid task");
  }
  return parsed.data;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const { app } = await requireAppAccess(request, (await params).appId);
    return NextResponse.json({ tasks: dal.getTasksByApp(app.id).map(serializeTask) });
  } catch (error) {
    const errorResponse = handleRouteError(error);
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

    const task = dal.createTask({
      app_id: app.id,
      title: input.title,
      description: input.description,
      status: input.status,
      assigned_to: input.assigned_to,
      created_by: user.id,
    });

    return NextResponse.json(serializeTask({ ...task, created_by_name: user.name, created_by_color: (user as any).color || null }), { status: 201 });
  } catch (error) {
    const errorResponse = handleRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
