import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { isConversationRunning } from "@/lib/server/conversation";
import { removeWorktree, stopPreview } from "@/lib/server/worktrees";

function enrichWorkItem(wi: any): any {
  const env = dal.getWorkItemEnv(wi.id) || {} as any;
  const session = wi.primary_conversation_id ? dal.getSessionForConversation(wi.primary_conversation_id) : null;
  const prArt = dal.getArtifactByKind(wi.id, "pull_request");
  const videoArt = dal.getArtifactByKind(wi.id, "demo_video");
  const seedArt = dal.getArtifactByKind(wi.id, "demo_seed");
  const scriptArt = dal.getArtifactByKind(wi.id, "demo_script");
  const walkthroughArt = dal.getArtifactByKind(wi.id, "walkthrough_script");
  const personasArt = dal.getArtifactByKind(wi.id, "demo_personas");

  let prMeta: any = {};
  if (prArt?.metadata_json) try { prMeta = JSON.parse(prArt.metadata_json); } catch {}
  let seedMeta: any = {};
  if (seedArt?.metadata_json) try { seedMeta = JSON.parse(seedArt.metadata_json); } catch {}

  const running = wi.primary_conversation_id ? isConversationRunning(wi.primary_conversation_id) : false;

  return {
    ...wi,
    description: wi.summary,
    task_type: wi.kind === "task" ? null : wi.kind,
    claude_status: running ? "running" : (session?.status || null),
    branch_name: env.branch_name || null,
    worktree_dir: env.worktree_dir || null,
    worktree_status: env.worktree_status || null,
    preview_port: env.preview_port || null,
    preview_pid: env.preview_pid || null,
    pr_url: prMeta.pr_url || null,
    pr_number: prMeta.pr_number || null,
    demo_video_path: videoArt?.file_path || null,
    demo_status: seedMeta.demo_status || null,
    demo_error: seedMeta.demo_error || null,
    demo_seed_script: seedArt?.inline_text || null,
    demo_seed_status: seedMeta.status || null,
    demo_seed_output: seedMeta.output || null,
    demo_script: scriptArt?.inline_text || null,
    demo_personas: personasArt?.inline_text || null,
    walkthrough_script: walkthroughArt?.inline_text || null,
  };
}

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
