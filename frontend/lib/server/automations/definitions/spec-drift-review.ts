/**
 * Spec Drift Review automation (RFC 23).
 *
 * Runs weekly. Reads persisted drift results from the spec validation system.
 * If drifted or missing specs are found, creates a maintenance conversation
 * that uses a tool-enabled agent to update the spec files in a worktree.
 * Notifies the project owner.
 */

import { getProvider } from "../../agent";
import { getBackgroundModel, getBackgroundProvider } from "../../config";
import * as dal from "../../dal";
import { readDriftResults, readSpecIndex, runSpecValidation, type DriftResult } from "../../spec";
import type { AutomationDefinition, AutomationContext, AutomationResult } from "../types";
import { executeAutomationTask } from "../execute";

function buildDriftPrompt(driftedItems: DriftResult[], specContext: string): string {
  const driftSummary = driftedItems
    .map((d, i) => `${i + 1}. **${d.path}** (${d.status}): ${d.detail}`)
    .join("\n");

  return `You are reviewing spec drift for a project. The spec validation system found the following issues:

## Drifted/Missing Specs
${driftSummary}

## Current Spec Index
${specContext || "(No spec index found)"}

## Task
Analyze the drift report. For each drifted or missing spec, determine whether the spec should be updated to match the current codebase.

If no updates are needed (e.g., all drift is intentional), respond with exactly:
NO_ACTION_NEEDED

If updates are needed, respond with a JSON object:
{
  "action_needed": true,
  "summary": "Brief summary of what needs updating",
  "task_description": "Specific instructions for which spec files to update and what changes to make. Reference the file paths. Be conservative — only update specs to match code, not the other way around."
}`;
}

export const specDriftReviewAutomation: AutomationDefinition = {
  key: "spec_drift_review",
  name: "Spec Drift Review",
  description: "Weekly review of spec drift to keep documentation in sync with code",
  defaultCron: "0 9 * * 1", // Monday 9 AM UTC
  defaultEnabled: true,

  async execute(ctx: AutomationContext): Promise<AutomationResult> {
    if (!ctx.app.directory) {
      return { status: "skipped", summary: "App has no directory", notificationsCreated: 0, workItemsCreated: 0 };
    }

    // Run fresh spec validation rather than relying on cached _drift.json.
    // runSpecValidation throws when the provider/tool fails; treat that as a failed run.
    let driftResults;
    try {
      driftResults = await runSpecValidation(ctx.app.directory, ctx.app.name);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { status: "failed", summary: `Spec validation failed: ${errMsg}`, notificationsCreated: 0, workItemsCreated: 0 };
    }
    const driftedItems = driftResults.filter((d) => d.status === "drifted" || d.status === "missing");

    if (driftedItems.length === 0) {
      return { status: "skipped", summary: "No spec drift detected", notificationsCreated: 0, workItemsCreated: 0 };
    }

    // Build spec context
    let specContext = "";
    const index = readSpecIndex(ctx.app.directory);
    if (index) {
      specContext = index.entries.map((e) => `- ${e.path}: ${e.summary}`).join("\n");
    }

    // Analyze drift with AI
    const prompt = buildDriftPrompt(driftedItems, specContext);
    const providerId = getBackgroundProvider();
    const provider = getProvider(providerId);
    const response = await provider.ephemeralQuery(prompt, { model: getBackgroundModel() });

    if (response.includes("NO_ACTION_NEEDED")) {
      return { status: "completed", summary: `Found ${driftedItems.length} drifted spec(s) but no updates needed`, notificationsCreated: 0, workItemsCreated: 0 };
    }

    // Parse analysis — parse failures are genuine errors (drift exists but we can't act on it)
    let analysis: { action_needed: boolean; summary: string; task_description: string };
    try {
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) {
        return { status: "failed", summary: "Could not parse drift analysis response", notificationsCreated: 0, workItemsCreated: 0 };
      }
      analysis = JSON.parse(match[0]);
      if (!analysis.action_needed) {
        return { status: "completed", summary: "Drift analysis determined no updates needed", notificationsCreated: 0, workItemsCreated: 0 };
      }
      if (typeof analysis.summary !== "string" || !analysis.summary ||
          typeof analysis.task_description !== "string" || !analysis.task_description) {
        return { status: "failed", summary: "Drift analysis response missing required fields", notificationsCreated: 0, workItemsCreated: 0 };
      }
    } catch {
      return { status: "failed", summary: "Failed to parse drift analysis response", notificationsCreated: 0, workItemsCreated: 0 };
    }

    // Check for existing open spec_drift_review tasks to avoid duplicates
    const existingWorkItems = dal.getWorkItemsByApp(ctx.appId);
    const hasOpenDriftTask = existingWorkItems.some(
      (wi) =>
        wi.status !== "done" &&
        (wi as any).origin_type === "automation" &&
        (wi as any).origin_automation_key === "spec_drift_review"
    );
    if (hasOpenDriftTask) {
      return {
        status: "completed",
        summary: `Found ${driftedItems.length} drifted spec(s), but an existing drift task is still open`,
        notificationsCreated: 0,
        workItemsCreated: 0,
      };
    }

    // Create maintenance conversation
    const conversation = dal.createConversation({
      app_id: ctx.appId,
      kind: "task",
      title: `Spec update: ${analysis.summary.slice(0, 80)}`,
      created_by: ctx.automationUserId,
      origin_type: "automation",
      origin_automation_key: "spec_drift_review",
      origin_run_id: ctx.runId,
    });

    const workItem = dal.createWorkItem({
      app_id: ctx.appId,
      primary_conversation_id: conversation.id,
      title: conversation.title,
      summary: analysis.task_description,
      created_by: ctx.automationUserId,
      origin_type: "automation",
      origin_automation_key: "spec_drift_review",
      origin_run_id: ctx.runId,
    });

    dal.createMessage({
      conversation_id: conversation.id,
      role: "user",
      kind: "text",
      author_user_id: ctx.automationUserId,
      body_md: analysis.task_description,
    });

    // Execute the spec updates via shared automation execution helper
    let execResult = { success: false, summary: "" };
    try {
      execResult = await executeAutomationTask({
        appId: ctx.appId,
        appDirectory: ctx.app.directory,
        appName: ctx.app.name,
        conversationId: conversation.id,
        workItemId: workItem.id,
        automationUserId: ctx.automationUserId,
        taskDescription: analysis.task_description,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      dal.addSystemMessage(conversation.id, `Automation execution failed: ${errMsg}`);
    }

    // Notify the project owner (verify they're still active, fall back to first active user)
    let recipientId: number | null = null;
    if (ctx.app.project_owner_user_id) {
      const owner = dal.getUser(ctx.app.project_owner_user_id);
      if (owner && !owner.deleted_at) {
        recipientId = owner.id;
      }
    }
    if (!recipientId) {
      const users = dal.getActiveUsers();
      recipientId = users[0]?.id ?? null;
    }

    const notifSummary = execResult.summary
      ? `${analysis.summary}\n\n**Result:** ${execResult.summary}`
      : analysis.summary;

    dal.createNotification({
      app_id: ctx.appId,
      kind: "spec_drift_review",
      title: execResult.success
        ? `Spec updated: ${driftedItems.length} drifted file(s) fixed`
        : `Spec drift detected: ${driftedItems.length} file(s) need review`,
      summary_md: notifSummary,
      recipient_user_id: recipientId,
      related_conversation_id: conversation.id,
      related_work_item_id: workItem.id,
      automation_key: "spec_drift_review",
      automation_run_id: ctx.runId,
      metadata_json: JSON.stringify({ drifted_paths: driftedItems.map((d) => d.path) }),
    });

    return {
      status: "completed",
      summary: `Found ${driftedItems.length} drifted spec(s). ${execResult.success ? "Updates applied." : "Created task for review."}`,
      notificationsCreated: 1,
      workItemsCreated: 1,
    };
  },
};
