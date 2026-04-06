import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import {
  getSetupAccess,
  getSetupAccessErrorMessage,
} from "@/lib/server/setup";

export async function GET(request: NextRequest) {
  const access = getSetupAccess();
  if (access.type === "needs_setup_blocked") {
    return NextResponse.json({ detail: getSetupAccessErrorMessage() }, { status: 403 });
  }
  if (access.type === "requires_auth") {
    try {
      await getAuthUser(request);
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ detail: e.message }, { status: 401 });
      }
      throw e;
    }
  }

  const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();

  // Security: resolve to absolute, constrain to home directory
  const resolved = path.resolve(dirPath);
  const home = os.homedir();
  if (!resolved.startsWith(home + path.sep) && resolved !== home) {
    return NextResponse.json(
      { detail: "Access denied: path must be within your home directory" },
      { status: 403 }
    );
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ detail: "Not a directory" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ detail: "Directory not found" }, { status: 404 });
  }

  const isGitRepo = fs.existsSync(path.join(resolved, ".git"));

  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        path: path.join(resolved, e.name),
        isGitRepo: fs.existsSync(path.join(resolved, e.name, ".git")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      current: resolved,
      parent: path.dirname(resolved) !== resolved ? path.dirname(resolved) : null,
      isGitRepo,
      dirs,
    });
  } catch {
    return NextResponse.json({ detail: "Cannot read directory" }, { status: 403 });
  }
}
