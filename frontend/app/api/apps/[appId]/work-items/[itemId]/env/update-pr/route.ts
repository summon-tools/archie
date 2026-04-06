import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { ghPrEdit, ghAuthStatus } from "@/lib/server/gh";
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

  // Get PR artifact
  const prArt = dal.getArtifactByKind(wi.id, "pull_request");
  let prMeta: any = {};
  if (prArt?.metadata_json) try { prMeta = JSON.parse(prArt.metadata_json); } catch {}

  if (!prMeta.pr_number) {
    return NextResponse.json(
      { detail: "Work item does not have a PR. Create one first." },
      { status: 400 }
    );
  }

  const env = dal.getWorkItemEnv(wi.id);
  const gitDir = env?.worktree_dir || app.directory;
  if (!gitDir) {
    return NextResponse.json(
      { detail: "No directory available" },
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
    // Gather context
    const codeDiff = getWorktreeCodeDiff(gitDir);
    const reflectionMessages = wi.primary_conversation_id
      ? getConversationMessages(wi.primary_conversation_id)
      : [];

    // Generate PR description via Claude
    const body = await generatePRDescription({
      task: { title: wi.title, description: wi.summary || undefined },
      codeDiff,
      reflectionMessages,
    });

    // Update PR
    const result = ghPrEdit(gitDir, prMeta.pr_number, { body });

    if (!result.success) {
      return NextResponse.json({ detail: result.message }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Failed to update PR" },
      { status: 500 }
    );
  }
}
