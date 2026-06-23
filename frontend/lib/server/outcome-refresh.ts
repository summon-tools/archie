import { getDb } from "@/lib/server/db";
import {
  runOutcomeEvidenceAssessment,
  type OutcomeEvidenceAssessor,
  type RunOutcomeEvidenceAssessmentResult,
} from "@/lib/server/outcome-assessments";
import {
  runOutcomeFollowupDetection,
  type OutcomeFollowupVerifier,
  type RunOutcomeFollowupDetectionOptions,
  type RunOutcomeFollowupDetectionResult,
} from "@/lib/server/outcome-followups";
import {
  recomputeOutcomeSnapshots,
  type RecomputeOutcomeSnapshotsResult,
} from "@/lib/server/outcome-snapshots";
import {
  getOutcomesGitHubSyncSettings,
  markOutcomeRefreshCompleted,
  markOutcomeRefreshStarted,
  runGitHubEvidenceSync,
  updateOutcomesGitHubSyncSettings,
  type RunGitHubEvidenceSyncOptions,
} from "@/lib/server/outcomes-github-sync";
import type { AppRow } from "@/lib/server/types";

type EvidenceFetcher = RunGitHubEvidenceSyncOptions["fetchEvidence"];
type GitHubEvidenceSyncResult = Awaited<ReturnType<typeof runGitHubEvidenceSync>>;

export interface RunOutcomeRefreshOptions {
  apps: AppRow[];
  userId: number | null;
  githubToken: string;
  mode: "manual" | "scheduled";
  rangeStart?: string | null;
  rangeEnd?: string | null;
  rangeDays?: number | null;
  fullRefresh?: boolean;
  fetchEvidence?: EvidenceFetcher;
  assessor?: OutcomeEvidenceAssessor;
  verifier?: OutcomeFollowupVerifier;
  fetchRepositoryPullRequests?: RunOutcomeFollowupDetectionOptions["fetchRepositoryPullRequests"];
  fetchPullRequestFiles?: RunOutcomeFollowupDetectionOptions["fetchPullRequestFiles"];
}

export interface RunOutcomeRefreshResult {
  mode: "manual" | "scheduled";
  range_start: string | null;
  range_end: string;
  full_refresh: boolean;
  scoped_work_item_ids: number[] | null;
  sync: GitHubEvidenceSyncResult;
  snapshots: Pick<RecomputeOutcomeSnapshotsResult, "recomputed_count" | "generated_at"> & {
    snapshot_ids: number[];
  };
  assessment: RunOutcomeEvidenceAssessmentResult;
  followups: RunOutcomeFollowupDetectionResult;
  settings: ReturnType<typeof getOutcomesGitHubSyncSettings>;
  generated_at: string;
  warnings: string[];
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function resolveRefreshRange(options: RunOutcomeRefreshOptions, previousSuccessfulRefreshAt: string | null): {
  rangeStart: string | null;
  rangeEnd: string;
  fullRefresh: boolean;
} {
  const rangeEnd = options.rangeEnd || new Date().toISOString();
  if (options.fullRefresh) {
    return { rangeStart: null, rangeEnd, fullRefresh: true };
  }
  if (options.rangeStart) {
    return { rangeStart: options.rangeStart, rangeEnd, fullRefresh: false };
  }
  if (options.rangeDays && options.rangeDays > 0) {
    return { rangeStart: isoDaysAgo(options.rangeDays), rangeEnd, fullRefresh: false };
  }
  if (previousSuccessfulRefreshAt) {
    return { rangeStart: previousSuccessfulRefreshAt, rangeEnd, fullRefresh: false };
  }
  return { rangeStart: null, rangeEnd, fullRefresh: true };
}

function boundedRange(params: unknown[], column: string, rangeStart: string, rangeEnd: string | null): string {
  params.push(rangeStart);
  let clause = `datetime(${column}) >= datetime(?)`;
  if (rangeEnd) {
    params.push(rangeEnd);
    clause += ` AND datetime(${column}) <= datetime(?)`;
  }
  return clause;
}

function loadChangedWorkItemIds(apps: AppRow[], rangeStart: string | null, rangeEnd: string | null): number[] | undefined {
  if (!rangeStart) return undefined;
  if (apps.length === 0) return [];

  const appIds = apps.map((app) => app.id);
  const params: unknown[] = [...appIds];
  const workItemUpdated = boundedRange(params, "wi.updated_at", rangeStart, rangeEnd);
  const runUpdated = boundedRange(params, "COALESCE(run.updated_at, run.created_at)", rangeStart, rangeEnd);
  const artifactCreated = boundedRange(params, "artifact.created_at", rangeStart, rangeEnd);
  const messageCreated = boundedRange(params, "message.created_at", rangeStart, rangeEnd);

  const rows = getDb().prepare(`
    SELECT wi.id
    FROM work_items wi
    WHERE wi.app_id IN (${placeholders(appIds.length)})
      AND (
        (${workItemUpdated})
        OR EXISTS (
          SELECT 1
          FROM runs run
          WHERE (
            run.work_item_id = wi.id
            OR (run.work_item_id IS NULL AND run.conversation_id = wi.primary_conversation_id)
          )
            AND (${runUpdated})
        )
        OR EXISTS (
          SELECT 1
          FROM artifacts artifact
          WHERE artifact.work_item_id = wi.id
            AND (${artifactCreated})
        )
        OR EXISTS (
          SELECT 1
          FROM messages message
          WHERE message.conversation_id = wi.primary_conversation_id
            AND (${messageCreated})
        )
      )
    ORDER BY wi.id ASC
  `).all(...params) as Array<{ id: number }>;

  return rows.map((row) => row.id);
}

function mergeWorkItemIds(...lists: Array<number[] | undefined>): number[] {
  return Array.from(new Set(lists.flatMap((list) => list || []))).sort((a, b) => a - b);
}

function compactSnapshotResult(result: RecomputeOutcomeSnapshotsResult): RunOutcomeRefreshResult["snapshots"] {
  return {
    recomputed_count: result.recomputed_count,
    snapshot_ids: result.snapshots.map((snapshot) => snapshot.id),
    generated_at: result.generated_at,
  };
}

function failedItemsMessage(stage: string, failedCount: number): string {
  const itemLabel = failedCount === 1 ? "item" : "items";
  return `Outcome refresh did not advance checkpoint: ${stage} had ${failedCount} failed ${itemLabel}.`;
}

export async function runOutcomeRefresh(options: RunOutcomeRefreshOptions): Promise<RunOutcomeRefreshResult> {
  const startedAt = new Date().toISOString();
  markOutcomeRefreshStarted(startedAt);

  const startingSettings = getOutcomesGitHubSyncSettings();
  const { rangeStart, rangeEnd, fullRefresh } = resolveRefreshRange(
    options,
    startingSettings.last_successful_refresh_at,
  );
  const warnings: string[] = [];

  if (options.mode === "manual" && options.userId) {
    updateOutcomesGitHubSyncSettings({ sync_user_id: options.userId });
  }

  const sync = await runGitHubEvidenceSync({
    apps: options.apps,
    userId: options.userId,
    githubToken: options.githubToken,
    mode: options.mode,
    rangeStart,
    rangeEnd,
    fetchEvidence: options.fetchEvidence,
  });
  warnings.push(...(sync.warnings || []));

  if (sync.run.status === "failed") {
    throw new Error(sync.run.error_text || "GitHub evidence sync failed");
  }
  if (sync.run.failed_count > 0) {
    throw new Error(failedItemsMessage("GitHub evidence sync", sync.run.failed_count));
  }

  const changedWorkItemIds = loadChangedWorkItemIds(options.apps, rangeStart, rangeEnd);
  const scopedWorkItemIds = changedWorkItemIds === undefined
    ? undefined
    : mergeWorkItemIds(
      changedWorkItemIds,
      sync.scanned_work_item_ids,
      sync.synced_work_item_ids,
    );
  const workItemArgs = scopedWorkItemIds === undefined
    ? {}
    : { workItemIds: scopedWorkItemIds };

  const snapshotResult = scopedWorkItemIds?.length === 0
    ? { recomputed_count: 0, snapshots: [], generated_at: new Date().toISOString() }
    : recomputeOutcomeSnapshots({
      apps: options.apps,
      ...workItemArgs,
    });

  const assessment = scopedWorkItemIds?.length === 0
    ? {
      assessed_count: 0,
      skipped_count: 0,
      failed_count: 0,
      assessment_ids: [],
      recomputed_snapshots: 0,
      generated_at: new Date().toISOString(),
      warnings: [],
    }
    : await runOutcomeEvidenceAssessment({
      apps: options.apps,
      ...workItemArgs,
      assessor: options.assessor,
    });
  warnings.push(...assessment.warnings);
  if (assessment.failed_count > 0) {
    throw new Error(failedItemsMessage("Outcome evidence assessment", assessment.failed_count));
  }

  const latestSettings = getOutcomesGitHubSyncSettings();
  const followups = await runOutcomeFollowupDetection({
    apps: options.apps,
    githubToken: options.githubToken,
    observationDays: latestSettings.observation_window_days,
    rangeStart: null,
    rangeEnd,
    fetchRepositoryPullRequests: options.fetchRepositoryPullRequests,
    fetchPullRequestFiles: options.fetchPullRequestFiles,
    verifier: options.verifier,
  });
  warnings.push(...followups.warnings);

  const completedAt = new Date().toISOString();
  const settings = markOutcomeRefreshCompleted({
    completedAt,
    successfulThrough: rangeEnd,
    scheduled: options.mode === "scheduled",
  });

  return {
    mode: options.mode,
    range_start: rangeStart,
    range_end: rangeEnd,
    full_refresh: fullRefresh,
    scoped_work_item_ids: scopedWorkItemIds ?? null,
    sync,
    snapshots: compactSnapshotResult(snapshotResult),
    assessment,
    followups,
    settings,
    generated_at: completedAt,
    warnings,
  };
}
