import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { getPlanExecutionElapsedMs } from "@/lib/server/plan-execution";
import type {
  AppRow,
  ConversationRow,
  ConversationStatus,
  HomeRoomRow,
  HomeRoomStatus,
  PlanRow,
  PlanStepRow,
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

export function handleRoomRouteError(error: unknown): NextResponse | null {
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

export const ROOM_STATUSES = new Set<HomeRoomStatus>(["open", "archived"]);
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
  if (user.role === "admin") return true;
  if (app.project_owner_user_id === user.id) return true;
  return false;
}

function assertCanAccessApp(user: { id: number; role: string }, app: AppRow): void {
  if (canAccessApp(user, app)) return;
  throw new ForbiddenError("App access required");
}

export function filterAppsForUser<T extends AppRow>(user: { id: number; role: string }, apps: T[]): T[] {
  return apps.filter((app) => canAccessApp(user, app));
}

export function serializeRoomPlan(roomId: number) {
  const room = dal.getRoom(roomId);
  const plan = dal.getPlansByRoom(roomId)[0] || null;
  const steps = plan ? dal.getPlanSteps(plan.id).map((step) => ({
    ...step,
    events: dal.getPlanStepEvents(step.id),
  })) : [];
  return {
    plan: plan ? {
      ...plan,
      execution_elapsed_ms: getPlanExecutionElapsedMs(plan),
    } : null,
    steps,
    planning_context_md: room?.planning_context_md || "",
    planning_context_updated_at: room?.planning_context_updated_at || null,
  };
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

export async function requireRoomAccess(
  request: NextRequest,
  appIdParam: string,
  roomIdParam: string,
): Promise<{ user: Awaited<ReturnType<typeof getAuthUser>>; app: AppRow; room: HomeRoomRow; appId: number; roomId: number }> {
  const { user, app, appId } = await requireAppAccess(request, appIdParam);
  const roomId = parseRouteId(roomIdParam, "roomId");
  const room = dal.getRoom(roomId);
  if (!room || room.app_id !== app.id) {
    throw new RouteInputError("Room not found", 404);
  }
  return { user, app, room, appId, roomId };
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

export async function requireRoomPlanAccess(
  request: NextRequest,
  appIdParam: string,
  roomIdParam: string,
): Promise<{ user: Awaited<ReturnType<typeof getAuthUser>>; app: AppRow; room: HomeRoomRow; plan: PlanRow; appId: number; roomId: number }> {
  const result = await requireRoomAccess(request, appIdParam, roomIdParam);
  const plan = dal.getPlansByRoom(result.room.id)[0];
  if (!plan) throw new RouteInputError("Plan not found", 404);
  return { ...result, plan };
}

export async function requirePlanStepAccess(
  request: NextRequest,
  appIdParam: string,
  roomIdParam: string,
  stepIdParam: string,
): Promise<{
  user: Awaited<ReturnType<typeof getAuthUser>>;
  app: AppRow;
  room: HomeRoomRow;
  plan: PlanRow;
  step: PlanStepRow;
  appId: number;
  roomId: number;
  stepId: number;
}> {
  const result = await requireRoomAccess(request, appIdParam, roomIdParam);
  const stepId = parseRouteId(stepIdParam, "stepId");
  const step = dal.getPlanStep(stepId);
  if (!step) throw new RouteInputError("Plan step not found", 404);

  const plan = dal.getPlan(step.plan_id);
  if (!plan || plan.room_id !== result.room.id) {
    throw new RouteInputError("Plan step not found", 404);
  }

  return { ...result, plan, step, stepId };
}
