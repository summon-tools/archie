import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { ghPrView } from "@/lib/server/gh";

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

  const app = dal.getApp(Number(appId));
  if (!app) {
    return NextResponse.json({ detail: "App not found" }, { status: 404 });
  }

  const wi = dal.getWorkItem(Number(itemId));
  if (!wi || wi.app_id !== Number(appId)) {
    return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
  }

  const env = dal.getWorkItemEnv(wi.id);
  const gitDir = env?.worktree_dir || app.directory;
  if (!gitDir) {
    return NextResponse.json({ state: "unknown" });
  }

  const prInfo = ghPrView(gitDir);
  if (!prInfo) {
    return NextResponse.json({ state: "unknown" });
  }

  return NextResponse.json({
    state: prInfo.state, // "OPEN" | "CLOSED" | "MERGED"
    pr_url: prInfo.pr_url,
    pr_number: prInfo.pr_number,
    title: prInfo.title,
  });
}
