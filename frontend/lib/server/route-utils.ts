import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import type {
  AppRow,
  ConversationRow,
  ConversationStatus,
  TaskRow,
  WorkItemRow,
  WorkItemStatus,
} from "@/lib/server/types";

export class RouteInputError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "RouteInputError";
  }
}

export function parseRouteId(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RouteInputError(`${name} must be a positive integer`);
  }
  return parsed;
}

export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RouteInputError("Request body must be a JSON object");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RouteInputError) throw error;
    throw new RouteInputError("Request body must be valid JSON");
  }
}

export function handleRouteError(error: unknown): NextResponse | null {
  if (error instanceof AuthError) {
    return NextResponse.json({ detail: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ detail: error.message }, { status: 403 });
  }
  if (error instanceof RouteInputError) {
    return NextResponse.json({ detail: error.message }, { status: error.status });
  }
  return null;
}

export const CONVERSATION_STATUSES = new Set<ConversationStatus>(["open", "closed", "archived"]);
export const WORK_ITEM_STATUSES = new Set<WorkItemStatus>(["proposed", "in_progress", "done"]);

export function requireEnumValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
  fieldName: string,
): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new RouteInputError(`${fieldName} is invalid`);
  }
  return value as T;
}

export function parseFileIds(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new RouteInputError("file_ids must be an array");
  if (value.length > 20) throw new RouteInputError("Too many files attached");
  const ids = value.map((entry) => {
    const parsed = typeof entry === "number" ? entry : Number(entry);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new RouteInputError("file_ids must contain positive integers");
    }
    return parsed;
  });
  return Array.from(new Set(ids));
}

export function requireAvailableAppFiles(appId: number, fileIds: number[]): void {
  for (const fileId of fileIds) {
    const file = dal.getAppFile(appId, fileId);
    if (!file || file.status !== "available") {
      throw new RouteInputError(`File not found: ${fileId}`, 404);
    }
  }
}

export function canAccessApp(user: { id: number; role: string }, app: AppRow): boolean {
  // Apps are workspace-wide. project_owner_user_id is used for ownership metadata,
  // not for hiding apps from authenticated teammates.
  void app;
  return Number.isInteger(user.id) && user.id > 0;
}

function assertCanAccessApp(user: { id: number; role: string }, app: AppRow): void {
  if (canAccessApp(user, app)) return;
  throw new ForbiddenError("App access required");
}

export function filterAppsForUser<T extends AppRow>(user: { id: number; role: string }, apps: T[]): T[] {
  return apps.filter((app) => canAccessApp(user, app));
}

export async function requireAppAccess(
  request: NextRequest,
  appIdParam: string,
): Promise<{ user: Awaited<ReturnType<typeof getAuthUser>>; app: AppRow; appId: number }> {
  const user = await getAuthUser(request);
  const appId = parseRouteId(appIdParam, "appId");
  const app = dal.getApp(appId);
  if (!app) throw new RouteInputError("App not found", 404);
  assertCanAccessApp(user, app);
  return { user, app, appId };
}

export async function requireConversationAccess(
  request: NextRequest,
  appIdParam: string,
  conversationIdParam: string,
): Promise<{ user: Awaited<ReturnType<typeof getAuthUser>>; app: AppRow; conversation: ConversationRow; appId: number; conversationId: number }> {
  const { user, app, appId } = await requireAppAccess(request, appIdParam);
  const conversationId = parseRouteId(conversationIdParam, "conversationId");
  const conversation = dal.getConversation(conversationId);
  if (!conversation || conversation.app_id !== app.id) {
    throw new RouteInputError("Conversation not found", 404);
  }
  return { user, app, conversation, appId, conversationId };
}

export async function requireWorkItemAccess(
  request: NextRequest,
  appIdParam: string,
  itemIdParam: string,
): Promise<{ user: Awaited<ReturnType<typeof getAuthUser>>; app: AppRow; workItem: WorkItemRow; appId: number; itemId: number }> {
  const { user, app, appId } = await requireAppAccess(request, appIdParam);
  const itemId = parseRouteId(itemIdParam, "itemId");
  const workItem = dal.getWorkItem(itemId);
  if (!workItem || workItem.app_id !== app.id) {
    throw new RouteInputError("Work item not found", 404);
  }
  return { user, app, workItem, appId, itemId };
}

export async function requireTaskAccess(
  request: NextRequest,
  appIdParam: string,
  taskIdParam: string,
): Promise<{ user: Awaited<ReturnType<typeof getAuthUser>>; app: AppRow; task: TaskRow; appId: number; taskId: number }> {
  const { user, app, appId } = await requireAppAccess(request, appIdParam);
  const taskId = parseRouteId(taskIdParam, "taskId");
  const task = dal.getTask(taskId);
  if (!task || task.app_id !== app.id) {
    throw new RouteInputError("Task not found", 404);
  }
  return { user, app, task, appId, taskId };
}
