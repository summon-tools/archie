import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import type { AppRow } from "@/lib/server/types";
import { readManifest, manifestToYaml } from "@/lib/server/manifest";

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

    const manifest = readManifest(app.directory);

    return NextResponse.json({
      manifest: manifest || null,
      manifest_yaml: manifest ? manifestToYaml(manifest) : null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to read manifest" },
      { status: 500 }
    );
  }
}
