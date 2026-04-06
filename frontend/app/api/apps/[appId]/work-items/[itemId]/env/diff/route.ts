import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { execSync } from "child_process";

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
  const cwd = env?.worktree_dir || app?.directory;
  if (!cwd) {
    return NextResponse.json({ detail: "No directory available for diff" }, { status: 404 });
  }
  const execOpts = { cwd, encoding: "utf-8" as const, timeout: 10000 };

  try {
    // Stage intent-to-add for new untracked files so they appear in diffs
    try {
      execSync("git add -N .", execOpts);
    } catch {
      // ignore — may fail if nothing to add
    }

    let diff = "";
    let stat = "";
    let filesChanged = 0;

    // Determine base ref: prefer main/master, fall back to HEAD
    let baseRef = "HEAD";
    try {
      execSync("git rev-parse --verify main", { ...execOpts, stdio: "pipe" });
      baseRef = "main";
    } catch {
      try {
        execSync("git rev-parse --verify master", { ...execOpts, stdio: "pipe" });
        baseRef = "master";
      } catch {
        // keep HEAD
      }
    }

    // Use diff against index (which includes intent-to-add untracked files)
    // combined with diff of index against base ref
    try {
      // Committed changes vs base + staged intent-to-add files
      diff = execSync(`git diff ${baseRef} --no-color`, execOpts);
    } catch (e: any) {
      // git diff can exit non-zero (e.g. diff filters failing) but still
      // produce valid diff output on stdout — extract it from the error.
      diff = typeof e?.stdout === "string" ? e.stdout : "";
    }

    // If diff against branch is empty, also try showing unstaged changes
    if (!diff.trim()) {
      try {
        diff = execSync("git diff --no-color", execOpts);
      } catch (e: any) {
        diff = typeof e?.stdout === "string" ? e.stdout : "";
      }
    }

    // Build stat
    try {
      stat = execSync(`git diff ${baseRef} --stat --no-color`, execOpts);
    } catch (e: any) {
      stat = typeof e?.stdout === "string" ? e.stdout : "";
    }
    {
      const statMatch = stat.match(/(\d+) files? changed/);
      filesChanged = statMatch ? Number(statMatch[1]) : 0;
    }

    if (!stat.trim()) {
      try {
        stat = execSync("git diff --stat --no-color", execOpts);
      } catch (e: any) {
        stat = typeof e?.stdout === "string" ? e.stdout : "";
      }
      const statMatch = stat.match(/(\d+) files? changed/);
      filesChanged = statMatch ? Number(statMatch[1]) : 0;
    }

    return NextResponse.json({ diff, stat, files_changed: filesChanged });
  } catch {
    return NextResponse.json({ diff: "", stat: "", files_changed: 0 });
  }
}
