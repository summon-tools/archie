import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { restartApp } from "@/lib/server/apps";
import type { AppRow } from "@/lib/server/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  try {
    const { appId } = await params;
    const id = parseInt(appId, 10);
    if (isNaN(id)) {
      return NextResponse.json(
        { detail: "Invalid app ID" },
        { status: 400 }
      );
    }

    const db = getDb();
    const app = db
      .prepare("SELECT * FROM apps WHERE id = ?")
      .get(id) as AppRow | undefined;

    if (!app) {
      return NextResponse.json(
        { detail: "App not found" },
        { status: 404 }
      );
    }

    const result = restartApp(app.directory, app.port, id);

    if (!result.success) {
      return NextResponse.json(
        { detail: result.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: result.message,
      port: app.port,
    });
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to restart app" },
      { status: 500 }
    );
  }
}
