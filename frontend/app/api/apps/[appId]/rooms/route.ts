import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { handleRoomRouteError, readJsonBody, requireAppAccess } from "@/lib/server/room-route-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const { appId } = await params;
    const { app } = await requireAppAccess(request, appId);

    return NextResponse.json({ rooms: dal.getRoomsByApp(app.id) });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const { appId } = await params;
    const { user: authUser, app } = await requireAppAccess(request, appId);

    const body = await readJsonBody(request);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ detail: "title is required" }, { status: 400 });
    }

    const room = dal.createRoom({
      app_id: app.id,
      title,
      purpose: typeof body.purpose === "string" ? body.purpose : "",
      created_by: authUser.id,
    });

    if (typeof body.message === "string" && body.message.trim()) {
      dal.createRoomMessage({
        room_id: room.id,
        role: "user",
        body_md: body.message.trim(),
        author_user_id: authUser.id,
      });
    }

    return NextResponse.json(room, { status: 201 });
  } catch (e) {
    const errorResponse = handleRoomRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
