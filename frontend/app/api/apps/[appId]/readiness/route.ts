import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import type { AppRow } from "@/lib/server/types";
import { ensureManifest } from "@/lib/server/manifest-migration";
import { checkAppReadiness } from "@/lib/server/readiness";

export async function GET(
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
      return NextResponse.json({ detail: "Invalid app ID" }, { status: 400 });
    }

    const db = getDb();
    const app = db.prepare("SELECT * FROM apps WHERE id = ?").get(id) as AppRow | undefined;
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const { manifest } = ensureManifest(app.id, app.directory, app.port);
    const framework = manifest.app.framework;
    const checks = checkAppReadiness(framework);

    return NextResponse.json({ framework, checks });
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to check readiness" },
      { status: 500 }
    );
  }
}
