import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import type { AppRow } from "@/lib/server/types";
import yaml from "js-yaml";
import { readManifest, writeManifest, manifestToYaml } from "@/lib/server/manifest";
import type { AppManifest } from "@/lib/server/manifest";
import { ensureManifest } from "@/lib/server/manifest-migration";
import { detectTechStack } from "@/lib/server/techstack";
import { generateManifest } from "@/lib/server/manifest";

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

    const { generated, manifest } = ensureManifest(id, app.directory, app.port);

    return NextResponse.json({
      manifest,
      manifest_yaml: manifestToYaml(manifest),
      auto_generated: generated,
    });
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to read manifest" },
      { status: 500 }
    );
  }
}

export async function PUT(
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

    const body = await request.json();

    // Accept either parsed manifest object or raw YAML string
    let manifest: AppManifest;
    if (body.manifest_yaml && typeof body.manifest_yaml === "string") {
      try {
        manifest = yaml.load(body.manifest_yaml) as AppManifest;
      } catch (e: any) {
        return NextResponse.json(
          { detail: `Invalid YAML: ${e.message || "parse error"}` },
          { status: 400 }
        );
      }
    } else if (body.manifest) {
      manifest = body.manifest;
    } else {
      return NextResponse.json({ detail: "manifest or manifest_yaml is required" }, { status: 400 });
    }

    if (!manifest?.app?.framework || !manifest?.dev?.command) {
      return NextResponse.json(
        { detail: "Manifest must include app.framework and dev.command" },
        { status: 400 }
      );
    }

    writeManifest(app.directory, manifest);

    return NextResponse.json({
      manifest,
      manifest_yaml: manifestToYaml(manifest),
    });
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to update manifest" },
      { status: 500 }
    );
  }
}

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
      return NextResponse.json({ detail: "Invalid app ID" }, { status: 400 });
    }

    const db = getDb();
    const app = db.prepare("SELECT * FROM apps WHERE id = ?").get(id) as AppRow | undefined;
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    // Force-regenerate from tech stack detection
    const stack = detectTechStack(app.directory);
    const manifest = generateManifest(stack, app.port, app.directory);
    writeManifest(app.directory, manifest);

    return NextResponse.json({
      manifest,
      manifest_yaml: manifestToYaml(manifest),
      regenerated: true,
    });
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to regenerate manifest" },
      { status: 500 }
    );
  }
}
