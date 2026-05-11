import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    return NextResponse.json({ rooms: dal.getRoomsByApp(app.id) });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const authUser = await getAuthUser(request);
    const { appId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const body = await request.json();
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
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
