import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { recordDemo } from "@/lib/server/demo";
import { demoGenerateSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";
import { getDb } from "@/lib/server/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, itemId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const wi = dal.getWorkItem(Number(itemId));
    if (!wi || wi.app_id !== Number(appId)) {
      return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = demoGenerateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    // Save voice preference to app if provided
    if (parsed.data.voice) {
      const db = getDb();
      db.prepare("UPDATE apps SET demo_tts_voice = ? WHERE id = ?")
        .run(parsed.data.voice, app.id);
    }

    const stream = await recordDemo(wi.id, app.id, parsed.data.script);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof Error && e.message.includes("already being generated")) {
      return NextResponse.json({ detail: e.message }, { status: 409 });
    }
    if (e instanceof Error && e.message.includes("No preview running")) {
      return NextResponse.json({ detail: e.message }, { status: 400 });
    }
    throw e;
  }
}
