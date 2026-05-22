import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";

import { getAuthUser, AuthError } from "@/lib/server/auth";
import { checkPortSync, stopApp } from "@/lib/server/apps";
import { detectTechStack } from "@/lib/server/techstack";
import * as dal from "@/lib/server/dal";
import { deleteAppUploadDirectory, deleteStoredFile } from "@/lib/server/file-storage";

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

    const app = dal.getApp(id);

    if (!app) {
      return NextResponse.json(
        { detail: "App not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(dal.buildAppResponse(app));
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to get app" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    const app = dal.getApp(id);
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const fields: { description?: string } = {};
    if (typeof body.description === "string") {
      fields.description = body.description.slice(0, 2000);
    }

    dal.updateApp(id, fields);

    const updated = dal.getApp(id);
    return NextResponse.json(dal.buildAppResponse(updated!));
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to update app" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  let user;
  try {
    user = await getAuthUser(request);
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

    const deleteFiles =
      request.nextUrl.searchParams.get("delete_files") === "true";

    const app = dal.getApp(id);

    if (!app) {
      return NextResponse.json(
        { detail: "App not found" },
        { status: 404 }
      );
    }

    const isAdmin = user.role === "admin";
    const isOwner =
      app.project_owner_user_id != null &&
      app.project_owner_user_id === user.id;
    if (!isAdmin && !isOwner) {
      return NextResponse.json(
        { detail: "Only the project owner or an admin can delete this app" },
        { status: 403 }
      );
    }

    // Stop the app if it's running
    if (app.port && checkPortSync(app.port)) {
      stopApp(app.directory, app.port, id);
    }

    // Drop PostgreSQL databases if applicable
    if (app.directory && fs.existsSync(app.directory)) {
      try {
        const stack = detectTechStack(app.directory);
        if (stack.database === "postgresql" && stack.databaseName) {
          // Drop the main development database
          execSync(`dropdb --if-exists "${stack.databaseName}"`, {
            shell: "bash",
            timeout: 15000,
            stdio: ["pipe", "pipe", "pipe"],
          });

          // Drop any worktree databases (pattern: dbname_task_N)
          try {
            const dbList = execSync(
              `psql -lqt 2>/dev/null | cut -d '|' -f 1 | grep "${stack.databaseName}_task_" | tr -d ' '`,
              { shell: "bash", timeout: 10000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
            );
            for (const dbName of dbList.trim().split("\n").filter(Boolean)) {
              execSync(`dropdb --if-exists "${dbName}"`, {
                shell: "bash",
                timeout: 15000,
                stdio: ["pipe", "pipe", "pipe"],
              });
            }
          } catch {
            // No worktree databases found — fine
          }
        }
      } catch {
        // Best effort — don't block deletion
      }
    }

    const uploadedFiles = dal.listAppFiles(id, true);

    // Clean up DB records (cascading delete handles conversations via FK)
    dal.deleteApp(id);
    for (const file of uploadedFiles) {
      deleteStoredFile(file);
    }
    deleteAppUploadDirectory(id);

    // Optionally remove the project directory
    if (deleteFiles && app.directory && fs.existsSync(app.directory)) {
      fs.rmSync(app.directory, { recursive: true, force: true });
    }

    return NextResponse.json({
      message: `App "${app.name}" deleted successfully`,
      files_deleted: deleteFiles,
    });
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to delete app" },
      { status: 500 }
    );
  }
}
