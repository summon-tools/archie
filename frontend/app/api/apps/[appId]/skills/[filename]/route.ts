import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import {
  readSkillFile,
  writeSkillFile,
  deleteSkillFile,
  validateSkillContent,
  extractSkillMeta,
} from "@/lib/server/skills";

/**
 * GET: Read a specific skill file.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; filename: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, filename } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    const content = readSkillFile(app.directory, filename);
    if (content === null) {
      return NextResponse.json({ detail: "Skill not found" }, { status: 404 });
    }

    const meta = extractSkillMeta(content);
    return NextResponse.json({ filename, content, ...meta });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * PUT: Create or update a skill file.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; filename: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, filename } = await params;
    const body = await request.json();
    const { content } = body;

    if (typeof content !== "string") {
      return NextResponse.json({ detail: "content is required" }, { status: 400 });
    }

    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    // Validate required fields
    const validationError = validateSkillContent(content);
    if (validationError) {
      return NextResponse.json({ detail: validationError }, { status: 400 });
    }

    writeSkillFile(app.directory, filename, content);
    const meta = extractSkillMeta(content);

    return NextResponse.json({ filename, ...meta });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * DELETE: Delete a skill file.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; filename: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, filename } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    const deleted = deleteSkillFile(app.directory, filename);
    if (!deleted) {
      return NextResponse.json({ detail: "Skill not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: filename });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}
