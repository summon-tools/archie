import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { resolveLogsDir } from "@/lib/server/app-paths";
import fs from "fs";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  const { appId, itemId } = await params;

  const wi = dal.getWorkItem(Number(itemId));
  if (!wi || wi.app_id !== Number(appId)) {
    return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
  }

  const app = dal.getApp(Number(appId));
  const env = dal.getWorkItemEnv(wi.id);
  const logBaseDir = env?.worktree_dir || app?.directory;
  if (!logBaseDir) {
    return NextResponse.json({ detail: "No directory available for logs" }, { status: 404 });
  }

  const lines = Number(request.nextUrl.searchParams.get("lines")) || 200;
  const logsDir = resolveLogsDir(logBaseDir);

  if (!fs.existsSync(logsDir)) {
    return NextResponse.json({ content: "", files: [], size: 0 });
  }

  // Read all .log files in the logs directory and combine them
  try {
    const logFiles = fs.readdirSync(logsDir)
      .filter((f) => f.endsWith(".log"))
      .sort();

    if (logFiles.length === 0) {
      return NextResponse.json({ content: "", files: [], size: 0 });
    }

    // Combine all log files with headers
    let combined = "";
    let totalSize = 0;

    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      try {
        const stat = fs.statSync(filePath);
        totalSize += stat.size;
        const raw = fs.readFileSync(filePath, "utf-8");
        if (raw.trim()) {
          const processName = file.replace(".log", "");
          combined += `── ${processName} ──\n${raw}\n`;
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Tail to requested line count
    const allLines = combined.split("\n");
    const content = allLines.slice(-lines).join("\n");

    return NextResponse.json({ content, files: logFiles, size: totalSize });
  } catch {
    return NextResponse.json({ content: "", files: [], size: 0 });
  }
}
