import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import type { AppRow, HomeRoomRow, PlanRow, PlanStepRow } from "@/lib/server/types";

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

function assertCanAccessApp(user: { id: number; role: string }, app: AppRow): void {
  if (user.role === "admin") return;
  if (app.project_owner_user_id === user.id) return;
  throw new ForbiddenError("App access required");
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
