import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { isConversationRunning } from "@/lib/server/conversation";

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
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const items = dal.getWorkItemsByApp(Number(appId));
    const workItems = items.map((wi) => {
      try { return enrichWorkItem(wi); } catch { return { ...wi, description: wi.summary }; }
    });

    return NextResponse.json({ work_items: workItems });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const authUser = await getAuthUser(request);
    const { appId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const body = await request.json();
    const message = body.message;
    if (!message || typeof message !== "string") {
      return NextResponse.json({ detail: "message is required" }, { status: 400 });
    }

    const taskType = body.task_type || null;

    // Auto-generate title from message
    const title = message.length > 60
      ? message.slice(0, 60) + "..."
      : message;

    // Create conversation first
    const conversation = dal.createConversation({
      app_id: Number(appId),
      kind: "task",
      title,
      created_by: authUser.id,
    });

    // Create work item pointing to conversation
    const kind = taskType && taskType !== "task" ? taskType : "task";
    const workItem = dal.createWorkItem({
      app_id: Number(appId),
      primary_conversation_id: conversation.id,
      title,
      summary: message,
      kind,
      created_by: authUser.id,
    });

    // Add the initial user message to the conversation
    dal.createMessage({
      conversation_id: conversation.id,
      role: "user",
      author_user_id: authUser.id,
      body_md: message,
    });

    const enriched = enrichWorkItem({
      ...workItem,
      created_by_name: authUser.name,
      created_by_color: (authUser as any).color || null,
    });

    return NextResponse.json(enriched, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
