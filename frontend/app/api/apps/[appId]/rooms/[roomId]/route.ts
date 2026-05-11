import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

function getRoomForApp(appId: number, roomId: number) {
  const app = dal.getApp(appId);
  if (!app) return { error: NextResponse.json({ detail: "App not found" }, { status: 404 }) };

  const room = dal.getRoom(roomId);
  if (!room || room.app_id !== app.id) {
    return { error: NextResponse.json({ detail: "Room not found" }, { status: 404 }) };
  }

  return { app, room };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId } = await params;
    const result = getRoomForApp(Number(appId), Number(roomId));
    if (result.error) return result.error;

    return NextResponse.json(result.room);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId, roomId } = await params;
    const result = getRoomForApp(Number(appId), Number(roomId));
    if (result.error) return result.error;

    const body = await request.json();
    const fields: Record<string, unknown> = {};
    if (body.title !== undefined) fields.title = String(body.title).trim();
    if (body.purpose !== undefined) fields.purpose = String(body.purpose);
    if (body.status !== undefined) fields.status = body.status;

    dal.updateRoom(result.room!.id, fields);
    return NextResponse.json(dal.getRoom(result.room!.id));
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
