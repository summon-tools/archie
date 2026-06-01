import * as dal from "@/lib/server/dal";
import { GitHubAppError, getValidGitHubUserToken } from "@/lib/server/github-app";
import { logger } from "@/lib/server/logger";
import { runOutcomeEvidenceAssessment } from "@/lib/server/outcome-assessments";
import { runOutcomeFollowupDetection } from "@/lib/server/outcome-followups";
import { runOutcomeLearningReport } from "@/lib/server/outcome-reports";
import { recomputeOutcomeSnapshots } from "@/lib/server/outcome-snapshots";
import { runGitHubEvidenceSync } from "@/lib/server/outcomes-github-sync";
import type { AppRow, LlmOutcomeJobKind, LlmOutcomeJobRow } from "@/lib/server/types";

type RangeInput = {
  rangeDays?: number | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
};

type WorkItemInput = RangeInput & {
  workItemIds?: number[];
};

export type OutcomeJobInput = {
  appIds: number[];
  rangeDays?: number | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  workItemIds?: number[];
  maxItems?: number;
  force?: boolean;
  observationDays?: number;
  maxCandidates?: number;
};

export interface EnqueueOutcomeJobInput {
  kind: LlmOutcomeJobKind;
  userId: number | null;
  apps: AppRow[];
  input?: Omit<OutcomeJobInput, "appIds">;
}

const runningJobs = new Set<number>();

function parseInput(job: LlmOutcomeJobRow): OutcomeJobInput {
  if (!job.input_json) return { appIds: [] };
  try {
    const parsed = JSON.parse(job.input_json);
    return {
      appIds: Array.isArray(parsed.appIds)
        ? parsed.appIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
        : [],
      rangeDays: parsed.rangeDays ?? null,
      rangeStart: parsed.rangeStart ?? null,
      rangeEnd: parsed.rangeEnd ?? null,
      workItemIds: Array.isArray(parsed.workItemIds)
        ? parsed.workItemIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
        : undefined,
      maxItems: parsed.maxItems === undefined ? undefined : Number(parsed.maxItems),
      force: parsed.force === true,
      observationDays: parsed.observationDays === undefined ? undefined : Number(parsed.observationDays),
      maxCandidates: parsed.maxCandidates === undefined ? undefined : Number(parsed.maxCandidates),
    };
  } catch {
    return { appIds: [] };
  }
}

function appsFromInput(input: OutcomeJobInput): AppRow[] {
  const allowed = new Set(input.appIds);
  return dal.getApps().filter((app) => allowed.has(app.id));
}

function rangeArgs(input: OutcomeJobInput): RangeInput {
  return {
    rangeDays: input.rangeStart ? null : input.rangeDays ?? null,
    rangeStart: input.rangeStart ?? null,
    rangeEnd: input.rangeEnd ?? null,
  };
}

function workItemArgs(input: OutcomeJobInput): WorkItemInput {
  return {
    ...rangeArgs(input),
    workItemIds: input.workItemIds,
  };
}

async function getGitHubTokenForJob(job: LlmOutcomeJobRow): Promise<string> {
  if (!job.requested_by_user_id) {
    throw new Error("GitHub outcome jobs require a requesting user.");
  }
  try {
    return (await getValidGitHubUserToken(job.requested_by_user_id)).token;
  } catch (error) {
    if (error instanceof GitHubAppError) throw new Error(error.message);
    throw error;
  }
}

async function executeOutcomeJob(job: LlmOutcomeJobRow): Promise<unknown> {
  const input = parseInput(job);
  const apps = appsFromInput(input);

  switch (job.kind) {
    case "github_sync": {
      const githubToken = await getGitHubTokenForJob(job);
      const sync = await runGitHubEvidenceSync({
        apps,
        userId: job.requested_by_user_id,
        githubToken,
        mode: "manual",
        ...rangeArgs(input),
      });
      const recomputed = recomputeOutcomeSnapshots({
        apps,
        ...rangeArgs(input),
      });
      return { ...sync, recomputed_snapshots: recomputed.recomputed_count };
    }
    case "snapshot_recompute": {
      const result = recomputeOutcomeSnapshots({
        apps,
        ...workItemArgs(input),
      });
      return {
        recomputed_count: result.recomputed_count,
        snapshot_ids: result.snapshots.map((snapshot) => snapshot.id),
        generated_at: result.generated_at,
      };
    }
    case "evidence_assessment": {
      return await runOutcomeEvidenceAssessment({
        apps,
        ...workItemArgs(input),
        maxItems: input.maxItems,
        force: input.force === true,
      });
    }
    case "learning_report": {
      const report = await runOutcomeLearningReport({
        apps,
        userId: job.requested_by_user_id,
        mode: "manual",
        ...rangeArgs(input),
      });
      return { report };
    }
    case "followup_detection": {
      const githubToken = await getGitHubTokenForJob(job);
      return await runOutcomeFollowupDetection({
        apps,
        githubToken,
        observationDays: input.observationDays || 14,
        maxCandidates: input.maxCandidates || 40,
        ...rangeArgs(input),
      });
    }
  }
}

function shouldAutoStartJobs(): boolean {
  return process.env.NODE_ENV !== "test";
}

export function serializeOutcomeJob(job: LlmOutcomeJobRow) {
  return {
    ...job,
    result: job.result_json ? JSON.parse(job.result_json) : null,
  };
}

export function enqueueOutcomeJob(input: EnqueueOutcomeJobInput): LlmOutcomeJobRow {
  const jobInput: OutcomeJobInput = {
    ...(input.input || {}),
    appIds: input.apps.map((app) => app.id),
  };
  const job = dal.createLlmOutcomeJob({
    kind: input.kind,
    requested_by_user_id: input.userId,
    input_json: JSON.stringify(jobInput),
    progress_text: "Queued",
  });
  if (shouldAutoStartJobs()) startOutcomeJob(job.id);
  return job;
}

export function startOutcomeJob(jobId: number): void {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  setTimeout(() => {
    runOutcomeJobNow(jobId).catch((error) => {
      logger.error({ err: error, jobId }, "outcome background job failed");
    }).finally(() => {
      runningJobs.delete(jobId);
    });
  }, 0);
}

export async function runOutcomeJobNow(jobId: number): Promise<LlmOutcomeJobRow> {
  const existing = dal.getLlmOutcomeJob(jobId);
  if (!existing) throw new Error("Outcome job not found");
  if (existing.status === "completed" || existing.status === "failed") return existing;

  let job = dal.updateLlmOutcomeJob(jobId, {
    status: "running",
    progress_text: "Running",
    started_at: new Date().toISOString(),
    error_text: null,
  });

  try {
    const result = await executeOutcomeJob(job);
    job = dal.updateLlmOutcomeJob(jobId, {
      status: "completed",
      progress_text: "Completed",
      result_json: JSON.stringify(result),
      completed_at: new Date().toISOString(),
    });
    return job;
  } catch (error) {
    job = dal.updateLlmOutcomeJob(jobId, {
      status: "failed",
      progress_text: "Failed",
      error_text: error instanceof Error ? error.message : "Outcome job failed",
      completed_at: new Date().toISOString(),
    });
    return job;
  }
}
