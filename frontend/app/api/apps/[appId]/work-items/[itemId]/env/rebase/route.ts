import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { rebaseFromMain } from "@/lib/server/git";

export async function POST(
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
  if (!env?.worktree_dir) {
    return NextResponse.json(
      { detail: "Work item does not have a worktree" },
      { status: 400 }
    );
  }

  const result = rebaseFromMain(env.worktree_dir);

  if (!result.success) {
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: result.message,
  });
}
