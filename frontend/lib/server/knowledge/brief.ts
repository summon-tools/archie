/**
 * Work-item brief generator.
 * After each task completes, generates a structured summary
 * capturing goal, decisions, files changed, and follow-up concerns.
 */

import { execSync } from "child_process";
import { getProvider } from "../agent";
import { getBackgroundModel, getBackgroundProvider } from "../config";
import * as dal from "../dal";
import { buildWorkItemBriefPrompt } from "../prompts/knowledge";

export interface WorkItemBrief {
  goal: string;
  decisions: { what: string; why: string }[];
  files_changed: string[];
  files_read: string[];
  routes_affected: string[];
  models_affected: string[];
  follow_up_concerns: string[];
}

/**
 * Generate a brief for a completed work item.
 * Uses recent conversation messages and git diff to produce a structured summary.
 */
export async function generateWorkItemBrief(
  appId: number,
  workItemId: number,
  runId: number,
  directory: string
): Promise<void> {
  try {
    const workItem = dal.getWorkItem(workItemId);
    if (!workItem) return;

    // Get conversation messages for context
    const conversationId = workItem.primary_conversation_id;
    const messages = conversationId ? dal.getConversationMessages(conversationId, 20) : [];
    const messageContext = messages
      .map((m) => `[${m.role}]: ${m.body_md.slice(0, 500)}`)
      .join("\n\n")
      .slice(0, 6000);

    // Get git diff info
    let diffStat = "";
    let changedFiles = "";
    try {
      diffStat = execSync("git diff main --stat --no-color", {
        cwd: directory, encoding: "utf-8", timeout: 5000,
      }).trim();
    } catch {}
    try {
      changedFiles = execSync("git diff main --name-only --no-color", {
        cwd: directory, encoding: "utf-8", timeout: 5000,
      }).trim();
    } catch {}

    const prompt = buildWorkItemBriefPrompt({
      taskTitle: workItem.title,
      taskSummary: workItem.summary,
      messageContext,
      diffStat,
      changedFiles,
    });

    const providerId = getBackgroundProvider();
    const provider = getProvider(providerId);
    const result = await provider.ephemeralQuery(prompt, { model: getBackgroundModel() });

    // Parse the result
    let brief: WorkItemBrief;
    try {
      const cleaned = result.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      brief = JSON.parse(cleaned);
    } catch {
      const match = result.match(/\{[\s\S]*\}/);
      if (!match) return;
      brief = JSON.parse(match[0]);
    }

    // Store as artifact
    dal.createArtifact({
      app_id: appId,
      work_item_id: workItemId,
      run_id: runId,
      kind: "work_item_brief",
      name: "Work Item Brief",
      storage_type: "inline",
      inline_text: JSON.stringify(brief),
      metadata_json: JSON.stringify({ generated_at: new Date().toISOString() }),
    });
  } catch {
    // Fire-and-forget — don't crash the caller
  }
}

/**
 * Get the brief for a specific work item.
 */
export function getWorkItemBrief(workItemId: number): WorkItemBrief | null {
  const artifact = dal.getArtifactByKind(workItemId, "work_item_brief");
  if (!artifact?.inline_text) return null;
  try {
    return JSON.parse(artifact.inline_text);
  } catch {
    return null;
  }
}

/**
 * Get recent briefs across work items for an app.
 */
export function getRecentBriefs(appId: number, limit = 5): { workItemId: number | null; brief: WorkItemBrief }[] {
  const artifacts = dal.getArtifactsByAppAndKind(appId, "work_item_brief", limit);
  return artifacts
    .map((a) => {
      try {
        return { workItemId: a.work_item_id, brief: JSON.parse(a.inline_text!) };
      } catch {
        return null;
      }
    })
    .filter((e): e is { workItemId: number | null; brief: WorkItemBrief } => e !== null);
}
