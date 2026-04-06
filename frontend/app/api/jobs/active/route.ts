import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { getEphemeralJobs } from "@/lib/server/ephemeral-jobs";
import * as dal from "@/lib/server/dal";

export interface ActiveJob {
  id: string;
  app_id: number;
  app_name: string;
  type: string;
  label: string;
  progress: string;
  started_at: number;
}

const WORKFLOW_LABELS: Record<string, string> = {
  spec_generate: "Generating spec…",
  spec_validate: "Validating spec…",
  spec_update_specs: "Updating specs…",
  knowledge_index: "Building codebase index…",
  "automation:completed_work_review": "Reviewing completed work…",
  "automation:spec_drift_review": "Checking spec drift…",
};

/**
 * GET: Returns all currently running background jobs across all apps.
 * Reads durable runs from SQLite + ephemeral in-memory jobs.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    const jobs: ActiveJob[] = [];

    // Durable runs from SQLite (spec, knowledge, conversation runs, etc.)
    const activeRuns = dal.getActiveRuns();
    for (const run of activeRuns) {
      // Skip conversation runs — they're shown inline in the conversation UI
      if (run.conversation_id) continue;

      const app = dal.getApp(run.app_id);
      const workflowKey = run.workflow_key || "unknown";
      jobs.push({
        id: `run-${run.id}`,
        app_id: run.app_id,
        app_name: app?.name || `App ${run.app_id}`,
        type: workflowKey,
        label: WORKFLOW_LABELS[workflowKey] || workflowKey,
        progress: run.progress_text || "",
        started_at: new Date(run.created_at).getTime(),
      });
    }

    // Ephemeral jobs (short-lived tasks like task-proposal evaluation)
    for (const ej of getEphemeralJobs()) {
      const app = dal.getApp(ej.app_id);
      jobs.push({
        id: ej.id,
        app_id: ej.app_id,
        app_name: app?.name || `App ${ej.app_id}`,
        type: ej.type,
        label: ej.label,
        progress: ej.label,
        started_at: ej.started_at,
      });
    }

    // Most recent first
    jobs.sort((a, b) => b.started_at - a.started_at);

    const notifAppId = new URL(request.url).searchParams.get("app_id")
      ? Number(new URL(request.url).searchParams.get("app_id"))
      : undefined;
    let notificationUnreadCount = 0;
    try {
      notificationUnreadCount = dal.getUnreadCount(user.id, notifAppId);
    } catch {}

    return NextResponse.json({
      jobs,
      notification_unread_count: notificationUnreadCount,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}
