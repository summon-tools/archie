/**
 * Completed Work Review automation (RFC 23).
 *
 * Runs nightly. Inspects completed user work from the last run window.
 * Groups by user, analyzes briefs, and determines whether team skills
 * should be created or updated. Creates a maintenance conversation
 * and notification when action is needed.
 */

import { getProvider } from "../../agent";
import { getBackgroundModel, getBackgroundProvider } from "../../config";
import * as dal from "../../dal";
import { getWorkItemBrief, type WorkItemBrief } from "../../knowledge/brief";
import { readSkillsIndex, readSkillFile } from "../../skills";
import type { AutomationDefinition, AutomationContext, AutomationResult } from "../types";
import { executeAutomationTask } from "../execute";
import type { WorkItemRow } from "../../types";

interface CandidateWorkItem {
  workItem: WorkItemRow;
  brief: WorkItemBrief;
}

/**
 * Collect completed work items from the run window that:
 * - belong to this app
 * - were completed by a user (origin_type = 'user')
 * - were completed since the last run (or last 48h if first run)
 */
function collectCandidates(ctx: AutomationContext): CandidateWorkItem[] {
  const cutoff = ctx.lastRunAt || new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Query done work items with user origin in the window
  const allDone = dal.getWorkItemsByApp(ctx.appId).filter(
    (wi) =>
      wi.status === "done" &&
      (wi as any).origin_type !== "automation" &&
      (wi as any).completed_at &&
      (wi as any).completed_at > cutoff
  );

  // Sort by completion time (most recent first) so the cap picks the most relevant
  allDone.sort((a, b) => {
    const aTime = (a as any).completed_at || "";
    const bTime = (b as any).completed_at || "";
    return bTime > aTime ? 1 : bTime < aTime ? -1 : 0;
  });

  const candidates: CandidateWorkItem[] = [];
  for (const wi of allDone) {
    let brief = getWorkItemBrief(wi.id);
    if (!brief) {
      // Fallback: build a minimal brief from work item metadata
      // rather than silently dropping items without generated briefs
      brief = {
        goal: wi.title,
        decisions: [],
        files_changed: [],
        files_read: [],
        routes_affected: [],
        models_affected: [],
        follow_up_concerns: [],
      };
      if (wi.summary) {
        brief.goal = `${wi.title}: ${wi.summary}`;
      }
    }
    candidates.push({ workItem: wi, brief });
  }
  return candidates;
}

/**
 * Group candidates by the user who owns the work.
 */
function groupByUser(candidates: CandidateWorkItem[]): Map<number, CandidateWorkItem[]> {
  const groups = new Map<number, CandidateWorkItem[]>();
  for (const c of candidates) {
    const userId = c.workItem.assigned_to ?? c.workItem.created_by;
    if (!userId) continue;
    const list = groups.get(userId) || [];
    list.push(c);
    groups.set(userId, list);
  }
  return groups;
}

function buildAnalysisPrompt(
  candidates: CandidateWorkItem[],
  skillsContext: string
): string {
  const workSummary = candidates
    .map((c, i) => {
      const b = c.brief;
      return [
        `### Work Item ${i + 1}: ${c.workItem.title}`,
        `Goal: ${b.goal}`,
        b.decisions.length > 0
          ? `Decisions:\n${b.decisions.map((d) => `- ${d.what} (why: ${d.why})`).join("\n")}`
          : "",
        b.files_changed.length > 0 ? `Files changed: ${b.files_changed.join(", ")}` : "",
        b.follow_up_concerns.length > 0
          ? `Follow-up concerns: ${b.follow_up_concerns.join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return `You are reviewing recently completed development work to determine if the team's skills (conventions and playbooks) should be updated.

## Current Team Skills
${skillsContext || "(No skills defined yet)"}

## Completed Work This Period
${workSummary}

## Task
Analyze the completed work and determine:

1. Should any NEW skills be created? (e.g., a new pattern or convention emerged from this work)
2. Should any EXISTING skills be updated? (e.g., a convention was refined or a new edge case was handled)

If no skill changes are needed, respond with exactly:
NO_ACTION_NEEDED

If changes are needed, respond with a JSON object:
{
  "action_needed": true,
  "summary": "Brief summary of recommended changes",
  "task_description": "A concise task request describing what skill files to create or update and why. Be specific about file names and content."
}

Be conservative. Only recommend skill changes for patterns that are clearly reusable, not one-off decisions.`;
}

export const completedWorkReviewAutomation: AutomationDefinition = {
  key: "completed_work_review",
  name: "Completed Work Review",
  description:
    "Nightly review of completed work to identify team skill updates",
  defaultCron: "0 22 * * *", // 10 PM UTC daily
  defaultEnabled: true,

  async execute(ctx: AutomationContext): Promise<AutomationResult> {
    const candidates = collectCandidates(ctx);
    if (candidates.length === 0) {
      return {
        status: "skipped",
        summary: "No completed user work to review",
        notificationsCreated: 0,
        workItemsCreated: 0,
      };
    }

    // Build skills context
    let skillsContext = "";
    if (ctx.app.directory) {
      const index = readSkillsIndex(ctx.app.directory);
      if (index) {
        const entries = index.entries.slice(0, 10);
        const parts: string[] = [];
        for (const entry of entries) {
          const content = readSkillFile(ctx.app.directory, entry.filename);
          parts.push(`**${entry.name}** (${entry.filename}): ${entry.description}\n${content?.slice(0, 500) || ""}`);
        }
        skillsContext = parts.join("\n\n");
      }
    }

    const userGroups = groupByUser(candidates);
    let totalNotifications = 0;
    let totalWorkItems = 0;
    // Set to true if any AI analysis chunk fails to parse — signals the runner to
    // not advance lastRunAt so those items are recollected on the next retry.
    let anyChunkFailed = false;

    // Build a set of work item IDs already covered by recent notifications (within the run window).
    // This prevents the same work item from triggering duplicate skill-update tasks,
    // while still processing users who completed new work after a prior notification.
    // Fetch only completed_work_review notifications for this app within the run window.
    // Use the same cutoff as collectCandidates (ctx.lastRunAt or 48h ago) so that
    // dedup covers exactly the same period as candidate collection — no more, no less.
    const windowCutoff = ctx.lastRunAt || new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const recentNotifications = dal.getNotifications({
      appId: ctx.appId,
      automationKey: "completed_work_review",
    }).filter((n) => n.created_at > windowCutoff);
    const alreadyCoveredIds = new Set<number>(
      recentNotifications.flatMap((n) => {
        try {
          const meta = JSON.parse(n.metadata_json || "{}");
          return Array.isArray(meta.source_work_item_ids) ? meta.source_work_item_ids : [];
        } catch {
          return [];
        }
      })
    );

    for (const [userId, groupCandidates] of userGroups) {
      // Filter out candidates already covered by a recent notification for this app
      const newCandidates = groupCandidates.filter((c) => !alreadyCoveredIds.has(c.workItem.id));
      if (newCandidates.length === 0) continue;

      // Analyze ALL newCandidates by chunking into groups of 15 to stay within
      // model context limits. Track coveredIds per-chunk: a chunk's IDs are only
      // added to coveredIds when the chunk produces a usable result (NO_ACTION_NEEDED
      // or valid JSON). Failed-chunk IDs are intentionally excluded so they can be
      // retried — the run returns "failed" at the end to prevent lastRunAt advancing.
      const CHUNK_SIZE = 15;
      const providerId = getBackgroundProvider();
      const provider = getProvider(providerId);

      const actionItems: Array<{ summary: string; task_description: string }> = [];
      const coveredIds: number[] = [];
      let hasParseErrors = false;

      for (let start = 0; start < newCandidates.length; start += CHUNK_SIZE) {
        const chunk = newCandidates.slice(start, start + CHUNK_SIZE);
        const chunkIds = chunk.map((c) => c.workItem.id);
        const response = await provider.ephemeralQuery(
          buildAnalysisPrompt(chunk, skillsContext),
          { model: getBackgroundModel() }
        );

        if (response.includes("NO_ACTION_NEEDED")) {
          coveredIds.push(...chunkIds);
          continue;
        }

        try {
          const match = response.match(/\{[\s\S]*\}/);
          if (!match) { hasParseErrors = true; anyChunkFailed = true; continue; }
          const parsed = JSON.parse(match[0]);
          if (!parsed.action_needed) {
            // Model explicitly says no action needed — chunk is fully covered.
            coveredIds.push(...chunkIds);
            continue;
          }
          // Validate required string fields; missing/wrong-typed fields are a parse error.
          if (typeof parsed.summary !== "string" || !parsed.summary ||
              typeof parsed.task_description !== "string" || !parsed.task_description) {
            hasParseErrors = true;
            anyChunkFailed = true;
            continue; // chunk IDs not added — they need a retry
          }
          actionItems.push({ summary: parsed.summary, task_description: parsed.task_description });
          coveredIds.push(...chunkIds);
        } catch {
          hasParseErrors = true;
          anyChunkFailed = true;
          // Do not add chunkIds to coveredIds — these items need a retry
        }
      }

      // Skip this user entirely if the model produced no usable action items.
      // Parse failures alone do NOT create a fallback task — that would cause
      // duplicate manual-review tasks on every retry (since failed-chunk IDs
      // are not in coveredIds and so are recollected until the run succeeds).
      // anyChunkFailed is already set; the run returns "failed" at the end so
      // lastRunAt doesn't advance and the retry picks up the uncovered items.
      if (actionItems.length === 0) continue;

      // Merge multi-chunk analyses into a single task so the user gets one notification.
      const mergedSummary = actionItems.map((a) => a.summary).join("; ");
      const mergedTaskDescription =
        actionItems.length === 1
          ? actionItems[0].task_description
          : actionItems.map((a, i) => `**Part ${i + 1}:** ${a.task_description}`).join("\n\n");

      // Create a maintenance conversation
      const conversation = dal.createConversation({
        app_id: ctx.appId,
        kind: "task",
        title: `Skills update: ${mergedSummary.slice(0, 80)}`,
        created_by: ctx.automationUserId,
        origin_type: "automation",
        origin_automation_key: "completed_work_review",
        origin_run_id: ctx.runId,
      });

      // Create the linked work item
      const workItem = dal.createWorkItem({
        app_id: ctx.appId,
        primary_conversation_id: conversation.id,
        title: conversation.title,
        summary: mergedTaskDescription,
        created_by: ctx.automationUserId,
        origin_type: "automation",
        origin_automation_key: "completed_work_review",
        origin_run_id: ctx.runId,
      });

      // Seed the conversation with the task description as a user message
      dal.createMessage({
        conversation_id: conversation.id,
        role: "user",
        kind: "text",
        author_user_id: ctx.automationUserId,
        body_md: mergedTaskDescription,
      });

      // Execute the skill update work via shared automation execution helper
      let execResult = { success: false, summary: "" };
      if (ctx.app.directory) {
        try {
          execResult = await executeAutomationTask({
            appId: ctx.appId,
            appDirectory: ctx.app.directory,
            appName: ctx.app.name,
            conversationId: conversation.id,
            workItemId: workItem.id,
            automationUserId: ctx.automationUserId,
            taskDescription: mergedTaskDescription,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          dal.addSystemMessage(conversation.id, `Automation execution failed: ${errMsg}`);
        }
      }

      totalWorkItems++;

      // Record only the IDs from successfully-analyzed chunks. Failed-chunk IDs are
      // intentionally absent so they will be recollected when the run is retried.
      const notifSummary = execResult.summary
        ? `${mergedSummary}\n\n**Result:** ${execResult.summary}`
        : mergedSummary;
      dal.createNotification({
        app_id: ctx.appId,
        kind: "completed_work_review",
        title: execResult.success
          ? `Skills updated based on your recent work`
          : `Skills update needs review from your recent work`,
        summary_md: notifSummary,
        recipient_user_id: userId,
        subject_user_id: userId,
        related_conversation_id: conversation.id,
        related_work_item_id: workItem.id,
        automation_key: "completed_work_review",
        automation_run_id: ctx.runId,
        metadata_json: JSON.stringify({ source_work_item_ids: coveredIds }),
      });

      totalNotifications++;
    }

    // If any chunk failed to parse, return "failed" so the runner does not advance
    // lastRunAt. The failed-chunk items will be recollected on the next retry;
    // already-covered items are protected from duplication via source_work_item_ids.
    return {
      status: anyChunkFailed ? "failed" : "completed",
      summary: `Reviewed ${candidates.length} completed items across ${userGroups.size} user(s). Created ${totalWorkItems} maintenance task(s).${anyChunkFailed ? " Some chunks failed to parse and will be retried." : ""}`,
      notificationsCreated: totalNotifications,
      workItemsCreated: totalWorkItems,
    };
  },
};
