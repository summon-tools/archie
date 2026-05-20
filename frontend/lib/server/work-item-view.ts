import { isConversationRunning } from "./conversation";
import * as dal from "./dal";
import type { WorkItemRow } from "./types";

type WorkItemWithUser = WorkItemRow & {
  created_by_name?: string | null;
  created_by_color?: string | null;
};

export function enrichWorkItem(wi: WorkItemWithUser): WorkItemWithUser & Record<string, unknown> {
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
    branch_source: env.branch_source || "generated",
    delete_branch_on_remove: env.delete_branch_on_remove ?? 1,
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
