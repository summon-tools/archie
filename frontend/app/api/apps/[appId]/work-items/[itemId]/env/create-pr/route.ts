import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { ghPrCreate, ghAuthStatus } from "@/lib/server/gh";
import { getConversationMessages } from "@/lib/server/conversation";
import { getWorktreeCodeDiff } from "@/lib/server/demo";
import { generatePRDescription } from "@/lib/server/pr-description";

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
  const gitDir = env?.worktree_dir || app.directory;
  if (!gitDir) {
    return NextResponse.json(
      { detail: "No directory available" },
      { status: 400 }
    );
  }

  if (!env?.branch_name) {
    return NextResponse.json(
      { detail: "Work item does not have a branch" },
      { status: 400 }
    );
  }

  // Check gh auth
  const auth = ghAuthStatus();
  if (!auth.authenticated) {
    return NextResponse.json(
      { detail: "GitHub CLI not authenticated. Run `gh auth login` in your terminal." },
      { status: 400 }
    );
  }

  try {
    // Generate PR description using Claude
    const codeDiff = getWorktreeCodeDiff(gitDir);
    const reflectionMessages = wi.primary_conversation_id
      ? getConversationMessages(wi.primary_conversation_id)
      : [];

    const body = await generatePRDescription({
      task: { title: wi.title, description: wi.summary || undefined },
      codeDiff,
      reflectionMessages,
    });

    const result = ghPrCreate(gitDir, wi.title, body);

    if (!result.success) {
      return NextResponse.json({ detail: result.message }, { status: 422 });
    }

    // Save PR info as an artifact
    dal.createArtifact({
      app_id: Number(appId),
      work_item_id: wi.id,
      kind: "pull_request",
      name: `PR #${result.pr_number}`,
      storage_type: "inline",
      metadata_json: JSON.stringify({
        pr_url: result.pr_url,
        pr_number: result.pr_number,
      }),
    });

    // System message
    if (wi.primary_conversation_id) {
      dal.addSystemMessage(wi.primary_conversation_id, `PR #${result.pr_number} created — ${result.pr_url}`);
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      pr_url: result.pr_url,
      pr_number: result.pr_number,
    });
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Failed to create PR" },
      { status: 500 }
    );
  }
}
