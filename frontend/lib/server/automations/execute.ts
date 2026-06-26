/**
 * Shared execution helper for automation agent runs.
 * Builds a system prompt with skills context, runs the agent in a worktree,
 * creates proper run records, and triggers post-run hooks (brief, knowledge refresh).
 */

import { getProvider } from "../agent";
import { getBackgroundModel, getBackgroundProvider } from "../config";
import * as dal from "../dal";
import { readSkillsIndex } from "../skills";
import { generateWorkItemBrief } from "../knowledge/brief";
import { buildGlobalSkillPromptContext } from "../global-skills";

export interface AutomationExecutionResult {
  success: boolean;
  summary: string;
}

/**
 * Build a prompt with the same context the normal conversation pipeline injects:
 * global skills and repo-local team skills.
 */
function buildAutomationPrompt(directory: string, appName: string, taskDescription: string): string {
  let prompt = `You are an AI assistant working on the "${appName}" project at ${directory}.\n\n`;
  prompt += `## Task\n${taskDescription}\n\n`;

  const globalSkillsContext = buildGlobalSkillPromptContext(taskDescription);
  if (globalSkillsContext.promptText) {
    prompt += `${globalSkillsContext.promptText}\n\n`;
  }

  // Inject team skills
  try {
    const skillsIndex = readSkillsIndex(directory);
    if (skillsIndex && skillsIndex.entries.length > 0) {
      prompt += `## Team Skills\nThe following team conventions are defined in .archie/skills/. Read the full skill file when it is relevant.\n\n` +
        skillsIndex.entries.map((e) => `- ${e.filename}: ${e.description}`).join("\n") + "\n\n";
    }
  } catch {}

  return prompt;
}

/**
 * Execute an automation task in a worktree with full context.
 * Creates a worktree, builds a context-rich prompt, runs the agent,
 * creates a proper runs record, and triggers brief generation on success.
 *
 * Returns null if worktree creation fails (caller should skip execution).
 */
export async function executeAutomationTask(opts: {
  appId: number;
  appDirectory: string;
  appName: string;
  conversationId: number;
  workItemId: number;
  automationUserId: number;
  taskDescription: string;
}): Promise<AutomationExecutionResult> {
  const { appId, appDirectory, appName, conversationId, workItemId, automationUserId, taskDescription } = opts;
  const { createWorktree, removeWorktree } = await import("../worktrees");

  // Create worktree
  dal.ensureWorkItemEnv(workItemId);
  dal.updateWorkItemEnv(workItemId, { worktree_status: "preparing" });

  const wt = createWorktree(appDirectory, workItemId, "automation-task");
  if (!wt.success) {
    dal.updateWorkItemEnv(workItemId, { worktree_status: "failed" });
    dal.addSystemMessage(conversationId, `Worktree creation failed: ${wt.message}`);
    return { success: false, summary: `Worktree creation failed: ${wt.message}` };
  }

  dal.updateWorkItemEnv(workItemId, {
    worktree_dir: wt.worktree_dir,
    branch_name: wt.branch_name,
    worktree_status: "ready",
  });
  dal.addSystemMessage(conversationId, `Workspace ready — branch \`${wt.branch_name}\``);

  // Build context-rich prompt (matching normal conversation pipeline)
  const prompt = buildAutomationPrompt(appDirectory, appName, taskDescription);

  // Create a conversation-level runs record with correct provider/model attribution
  const providerId = getBackgroundProvider();
  const modelId = getBackgroundModel();
  const agentRun = dal.createRun({
    app_id: appId,
    conversation_id: conversationId,
    work_item_id: workItemId,
    workflow_key: "stream",
    status: "running",
    provider_id: providerId,
    model_id: modelId,
    progress_text: "Automation: executing task...",
  });

  // Run the agent
  const provider = getProvider(providerId);
  const stream = provider.toolEnabledStream(prompt, {
    model: getBackgroundModel(),
    cwd: wt.worktree_dir,
  });

  let executionSummary = "";
  let hasError = false;
  for await (const event of stream) {
    if (event.type === "result" && event.resultText) {
      executionSummary = event.resultText.slice(0, 500);
    } else if (event.type === "error") {
      hasError = true;
      dal.addSystemMessage(conversationId, `Agent error: ${event.detail}`);
    }
  }

  // Accept success even without text output (tool-only runs are valid)
  const success = !hasError;

  // Complete the agent run record
  dal.updateRun(agentRun.id, {
    status: success ? "completed" : "failed",
    result_json: executionSummary ? JSON.stringify({ summary: executionSummary }) : null,
    error_text: hasError ? "Agent reported errors during execution" : null,
  });

  // Record agent output (use a generic completion note when agent produced no text output)
  dal.createMessage({
    conversation_id: conversationId,
    role: "assistant",
    kind: "text",
    body_md: executionSummary || (success ? "Task completed." : "Task encountered errors — see system messages above."),
  });

  if (success) {
    // Mark work item done
    dal.updateWorkItem(workItemId, {
      status: "done",
      completed_at: new Date().toISOString(),
      completed_by_user_id: automationUserId,
    });
    dal.updateConversation(conversationId, { status: "closed" });

    // Post-run hooks: brief generation (runs against worktree before removal)
    generateWorkItemBrief(appId, workItemId, agentRun.id, wt.worktree_dir).catch(() => {});

    // Auto-commit any uncommitted changes before removing worktree
    // (same as done/archive routes)
    try {
      const { runGitSafe } = await import("../worktrees");
      const status = runGitSafe(wt.worktree_dir, ["status", "--porcelain"]);
      if (status.stdout.trim()) {
        runGitSafe(wt.worktree_dir, ["add", "-A"]);
        runGitSafe(wt.worktree_dir, [
          "commit", "-m",
          `Automation: work item #${workItemId}`,
        ]);
      }
    } catch { /* best effort */ }

    // Remove worktree (keep branch for review)
    try {
      removeWorktree(appDirectory, wt.worktree_dir, "");
      dal.updateWorkItemEnv(workItemId, {
        worktree_dir: null,
        worktree_status: null,
        preview_port: null,
        preview_pid: null,
      });
    } catch { /* best effort */ }

    // Knowledge refresh runs against app directory (worktree is gone)
    setTimeout(() => {
      import("../knowledge/indexer").then(({ refreshIfStale }) => {
        refreshIfStale(appId, appDirectory).catch(() => {});
      }).catch(() => {});
    }, 3000);
  }

  // Always return a non-empty summary so notification builders can surface "what was done."
  // Tool-only runs produce no resultText, so fall back to a generic completion message.
  return {
    success,
    summary: executionSummary || (success ? "Task completed." : "Task encountered errors during execution."),
  };
}
