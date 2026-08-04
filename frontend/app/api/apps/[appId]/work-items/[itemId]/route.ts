import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { removeWorktree, stopPreview } from "@/lib/server/worktrees";
import { enrichWorkItem } from "@/lib/server/work-item-view";
import { handleRouteError, readJsonBody, requireEnumValue, requireWorkItemAccess, WORK_ITEM_STATUSES } from "@/lib/server/route-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    const { appId, itemId } = await params;
    const { workItem } = await requireWorkItemAccess(request, appId, itemId);

    return NextResponse.json(enrichWorkItem(workItem));
  } catch (e) {
    const errorResponse = handleRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    const { appId, itemId } = await params;
    const { workItem } = await requireWorkItemAccess(request, appId, itemId);

    const body = await readJsonBody(request);
    const fields: any = {};
    if (body.title !== undefined) fields.title = body.title;
    if (body.description !== undefined) fields.summary = body.description;
    if (body.summary !== undefined) fields.summary = body.summary;
    if (body.status !== undefined) fields.status = requireEnumValue(body.status, WORK_ITEM_STATUSES, "status");

    dal.updateWorkItem(workItem.id, fields);

    const updated = dal.getWorkItem(workItem.id)!;
    return NextResponse.json(enrichWorkItem(updated));
  } catch (e) {
    const errorResponse = handleRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    const { appId, itemId } = await params;
    const { app, workItem: wi } = await requireWorkItemAccess(request, appId, itemId);

    // Clean up env (worktree, preview) — best effort
    try {
      const env = dal.getWorkItemEnv(wi.id);
      if (env) {
        if (env.preview_pid || env.preview_port) {
          stopPreview(env.preview_pid, env.worktree_dir, env.preview_port, { appId: Number(appId), workItemId: wi.id });
        }
        if (env.worktree_dir && env.branch_name && app.directory) {
          removeWorktree(app.directory, env.worktree_dir, env.delete_branch_on_remove ? env.branch_name : "");
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
    const errorResponse = handleRouteError(e);
    if (errorResponse) return errorResponse;
    throw e;
  }
}
