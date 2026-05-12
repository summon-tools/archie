import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { handleRoomRouteError, readJsonBody, requireRoomAccess } from "@/lib/server/room-route-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { room } = await requireRoomAccess(request, appId, roomId);

    return NextResponse.json(room);
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; roomId: string }> },
) {
  try {
    const { appId, roomId } = await params;
    const { room } = await requireRoomAccess(request, appId, roomId);

    const body = await readJsonBody(request);
    const fields: Record<string, unknown> = {};
    if (body.title !== undefined) fields.title = String(body.title).trim();
    if (body.purpose !== undefined) fields.purpose = String(body.purpose);
    if (body.status !== undefined) fields.status = body.status;

    dal.updateRoom(room.id, fields);
    return NextResponse.json(dal.getRoom(room.id));
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
