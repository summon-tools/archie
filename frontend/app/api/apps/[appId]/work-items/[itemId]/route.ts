import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { removeWorktree, stopPreview } from "@/lib/server/worktrees";
import { enrichWorkItem } from "@/lib/server/work-item-view";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, itemId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const wi = dal.getWorkItem(Number(itemId));
    if (!wi || wi.app_id !== Number(appId)) {
      return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
    }

    return NextResponse.json(enrichWorkItem(wi));
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, itemId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const wi = dal.getWorkItem(Number(itemId));
    if (!wi || wi.app_id !== Number(appId)) {
      return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
    }

    const body = await request.json();
    const fields: any = {};
    if (body.title !== undefined) fields.title = body.title;
    if (body.description !== undefined) fields.summary = body.description;
    if (body.summary !== undefined) fields.summary = body.summary;
    if (body.status !== undefined) fields.status = body.status;

    dal.updateWorkItem(Number(itemId), fields);

    const updated = dal.getWorkItem(Number(itemId))!;
    return NextResponse.json(enrichWorkItem(updated));
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, itemId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const wi = dal.getWorkItem(Number(itemId));
    if (!wi || wi.app_id !== Number(appId)) {
      return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
    }

    // Clean up env (worktree, preview) — best effort
    try {
      const env = dal.getWorkItemEnv(wi.id);
      if (env) {
        if (env.preview_pid || env.preview_port) {
          stopPreview(env.preview_pid, env.worktree_dir, env.preview_port, { appId: Number(appId), workItemId: wi.id });
        }
        if (env.worktree_dir && env.branch_name && app.directory) {
          removeWorktree(app.directory, env.worktree_dir, env.branch_name);
        }
      }
    } catch {}

    // Delete work item first (before conversation, to avoid FK issues)
    dal.deleteWorkItem(wi.id);

    // Delete conversation if it exists
    if (wi.primary_conversation_id) {
      try { dal.deleteConversation(wi.primary_conversation_id); } catch {}
    }

    return NextResponse.json({ message: "Work item deleted" });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
