import * as dal from "@/lib/server/dal";
import { getDb } from "@/lib/server/db";
import { getPullRequestEvidence, type PullRequestEvidencePayload } from "@/lib/server/github";
import { getValidGitHubUserToken } from "@/lib/server/github-app";
import { parsePullRequestMetadata, resolvePullRequestRepo } from "@/lib/server/github-pr-utils";
import { logger } from "@/lib/server/logger";
import type { AppRow } from "@/lib/server/types";

const OBSERVATION_WINDOW_SETTING = "outcomes_observation_window_days";
const DAILY_SYNC_ENABLED_SETTING = "outcomes_daily_github_sync_enabled";
const DAILY_SYNC_HOUR_SETTING = "outcomes_daily_github_sync_hour_utc";
const SYNC_USER_SETTING = "outcomes_github_sync_user_id";
const LAST_SCHEDULED_SYNC_SETTING = "outcomes_last_scheduled_github_sync_at";

export const DEFAULT_OBSERVATION_WINDOW_DAYS = 14;
const DEFAULT_DAILY_SYNC_HOUR_UTC = 6;
const SCHEDULER_TICK_MS = 60_000;

type EvidenceFetcher = (params: {
  owner: string;
  repo: string;
  pr_number: number;
  token: string;
}) => Promise<PullRequestEvidencePayload>;

type SyncCandidate = {
  app_id: number;
  app_name: string;
  app_github_repo: string | null;
  work_item_id: number;
  work_item_title: string;
  work_item_updated_at: string;
  pr_metadata_json: string | null;
};

export interface OutcomesGitHubSyncSettings {
  observation_window_days: number;
  daily_sync_enabled: boolean;
  daily_sync_hour_utc: number;
  sync_user_id: number | null;
  last_scheduled_sync_at: string | null;
}

export interface RunGitHubEvidenceSyncOptions {
  apps: AppRow[];
  userId: number | null;
  githubToken: string;
  mode: "manual" | "scheduled";
  rangeStart?: string | null;
  rangeEnd?: string | null;
  rangeDays?: number | null;
  maxPrs?: number;
  fetchEvidence?: EvidenceFetcher;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseSettingJson<T>(key: string, fallback: T): T {
  const value = dal.getSetting(key);
  return value === null || value === undefined ? fallback : (value as unknown as T);
}

export function getOutcomesGitHubSyncSettings(): OutcomesGitHubSyncSettings {
  const dailySyncEnabled = parseSettingJson<boolean>(DAILY_SYNC_ENABLED_SETTING, true);
  return {
    observation_window_days: asPositiveInt(parseSettingJson(OBSERVATION_WINDOW_SETTING, DEFAULT_OBSERVATION_WINDOW_DAYS), DEFAULT_OBSERVATION_WINDOW_DAYS),
    daily_sync_enabled: dailySyncEnabled !== false,
    daily_sync_hour_utc: Math.min(23, Math.max(0, asPositiveInt(parseSettingJson(DAILY_SYNC_HOUR_SETTING, DEFAULT_DAILY_SYNC_HOUR_UTC), DEFAULT_DAILY_SYNC_HOUR_UTC))),
    sync_user_id: parseSettingJson<number | null>(SYNC_USER_SETTING, null),
    last_scheduled_sync_at: parseSettingJson<string | null>(LAST_SCHEDULED_SYNC_SETTING, null),
  };
}

export function updateOutcomesGitHubSyncSettings(fields: Partial<Pick<
  OutcomesGitHubSyncSettings,
  "observation_window_days" | "daily_sync_enabled" | "daily_sync_hour_utc" | "sync_user_id"
>>): OutcomesGitHubSyncSettings {
  if (fields.observation_window_days !== undefined) {
    dal.setSetting(OBSERVATION_WINDOW_SETTING, asPositiveInt(fields.observation_window_days, DEFAULT_OBSERVATION_WINDOW_DAYS));
  }
  if (fields.daily_sync_enabled !== undefined) {
    dal.setSetting(DAILY_SYNC_ENABLED_SETTING, Boolean(fields.daily_sync_enabled));
  }
  if (fields.daily_sync_hour_utc !== undefined) {
    dal.setSetting(DAILY_SYNC_HOUR_SETTING, Math.min(23, Math.max(0, asPositiveInt(fields.daily_sync_hour_utc, DEFAULT_DAILY_SYNC_HOUR_UTC))));
  }
  if (fields.sync_user_id !== undefined) {
    dal.setSetting(SYNC_USER_SETTING, fields.sync_user_id);
  }
  return getOutcomesGitHubSyncSettings();
}

function rangeFromOptions(options: Pick<RunGitHubEvidenceSyncOptions, "rangeStart" | "rangeEnd" | "rangeDays">): {
  rangeStart: string | null;
  rangeEnd: string | null;
} {
  const rangeEnd = options.rangeEnd || new Date().toISOString();
  if (options.rangeStart) return { rangeStart: options.rangeStart, rangeEnd };
  if (options.rangeDays && options.rangeDays > 0) return { rangeStart: isoDaysAgo(options.rangeDays), rangeEnd };
  return { rangeStart: null, rangeEnd };
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

function getSyncCandidates(apps: AppRow[], rangeStart: string | null, rangeEnd: string | null, limit: number): SyncCandidate[] {
  if (apps.length === 0) return [];
  const appIds = apps.map((app) => app.id);
  const conditions = [`wi.app_id IN (${placeholders(appIds.length)})`, "pr.id IS NOT NULL"];
  const params: unknown[] = [...appIds];
  if (rangeStart) {
    conditions.push("datetime(wi.updated_at) >= datetime(?)");
    params.push(rangeStart);
  }
  if (rangeEnd) {
    conditions.push("datetime(wi.updated_at) <= datetime(?)");
    params.push(rangeEnd);
  }
  params.push(limit);

  return getDb().prepare(`
    SELECT
      app.id AS app_id,
      app.name AS app_name,
      app.github_repo AS app_github_repo,
      wi.id AS work_item_id,
      wi.title AS work_item_title,
      wi.updated_at AS work_item_updated_at,
      pr.metadata_json AS pr_metadata_json
    FROM work_items wi
    JOIN apps app ON app.id = wi.app_id
    JOIN artifacts pr ON pr.id = (
      SELECT id FROM artifacts
      WHERE work_item_id = wi.id AND kind = 'pull_request'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    WHERE ${conditions.join(" AND ")}
    ORDER BY wi.updated_at DESC, wi.id DESC
    LIMIT ?
  `).all(...params) as SyncCandidate[];
}

function snapshotFromEvidence(candidate: SyncCandidate, repo: { owner: string; repo: string }, payload: PullRequestEvidencePayload) {
  const pr = payload.pr;
  const state = pr.merged_at ? "MERGED" : String(pr.state || "UNKNOWN").toUpperCase();
  return {
    app_id: candidate.app_id,
    work_item_id: candidate.work_item_id,
    owner: repo.owner,
    repo: repo.repo,
    pr_number: Number(pr.number),
    pr_url: String(pr.html_url || ""),
    title: pr.title || "",
    state,
    author_login: pr.user?.login ?? null,
    head_ref: pr.head?.ref ?? null,
    base_ref: pr.base?.ref ?? null,
    merged_at: pr.merged_at ?? null,
    closed_at: pr.closed_at ?? null,
    github_created_at: pr.created_at ?? null,
    github_updated_at: pr.updated_at ?? null,
    additions: typeof pr.additions === "number" ? pr.additions : null,
    deletions: typeof pr.deletions === "number" ? pr.deletions : null,
    changed_files: typeof pr.changed_files === "number" ? pr.changed_files : null,
    commits_count: typeof pr.commits === "number" ? pr.commits : payload.commits.length,
    issue_comments_count: payload.issue_comments.length,
    review_comments_count: payload.review_comments.length,
    reviews_count: payload.reviews.length,
    raw_json: JSON.stringify(pr),
  };
}

export async function runGitHubEvidenceSync(options: RunGitHubEvidenceSyncOptions) {
  const { rangeStart, rangeEnd } = rangeFromOptions(options);
  const syncRun = dal.createGitHubOutcomeSyncRun({
    requested_by_user_id: options.userId,
    mode: options.mode,
    range_start: rangeStart,
    range_end: rangeEnd,
  });
  const fetchEvidence = options.fetchEvidence || getPullRequestEvidence;
  const maxPrs = options.maxPrs ?? 50;
  const warnings: string[] = [];
  let scanned = 0;
  let synced = 0;
  let failed = 0;

  try {
    const candidates = getSyncCandidates(options.apps, rangeStart, rangeEnd, maxPrs);
    for (const candidate of candidates) {
      scanned += 1;
      const pr = parsePullRequestMetadata(candidate.pr_metadata_json);
      if (!pr.prNumber) {
        warnings.push(`Work item ${candidate.work_item_id} has an invalid PR artifact.`);
        failed += 1;
        continue;
      }
      const repo = resolvePullRequestRepo({ appGithubRepo: candidate.app_github_repo, prUrl: pr.prUrl });
      if (!repo) {
        warnings.push(`Work item ${candidate.work_item_id} has no resolvable GitHub repository.`);
        failed += 1;
        continue;
      }

      try {
        const payload = await fetchEvidence({
          owner: repo.owner,
          repo: repo.repo,
          pr_number: pr.prNumber,
          token: options.githubToken,
        });
        dal.replaceGitHubPrEvidence({
          snapshot: snapshotFromEvidence(candidate, repo, payload),
          issue_comments: payload.issue_comments,
          review_comments: payload.review_comments,
          reviews: payload.reviews,
          commits: payload.commits,
        });
        synced += 1;
      } catch (error) {
        failed += 1;
        warnings.push(`Failed to sync PR for work item ${candidate.work_item_id}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    const completed = dal.updateGitHubOutcomeSyncRun(syncRun.id, {
      status: "completed",
      scanned_count: scanned,
      synced_count: synced,
      failed_count: failed,
      warnings,
      completed_at: new Date().toISOString(),
    });
    if (options.mode === "manual" && options.userId) {
      updateOutcomesGitHubSyncSettings({ sync_user_id: options.userId });
    }
    return { run: completed, warnings };
  } catch (error) {
    const failedRun = dal.updateGitHubOutcomeSyncRun(syncRun.id, {
      status: "failed",
      scanned_count: scanned,
      synced_count: synced,
      failed_count: failed,
      warnings,
      error_text: error instanceof Error ? error.message : "GitHub evidence sync failed",
      completed_at: new Date().toISOString(),
    });
    return { run: failedRun, warnings };
  }
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerRunning = false;

function scheduledSyncDue(settings: OutcomesGitHubSyncSettings): boolean {
  if (!settings.daily_sync_enabled || !settings.sync_user_id) return false;
  const now = new Date();
  if (now.getUTCHours() !== settings.daily_sync_hour_utc) return false;
  if (!settings.last_scheduled_sync_at) return true;
  return now.getTime() - new Date(settings.last_scheduled_sync_at).getTime() >= 20 * 60 * 60 * 1000;
}

async function runScheduledSyncIfDue(): Promise<void> {
  if (schedulerRunning) return;
  const settings = getOutcomesGitHubSyncSettings();
  if (!scheduledSyncDue(settings)) return;

  schedulerRunning = true;
  try {
    const githubAuth = await getValidGitHubUserToken(settings.sync_user_id!);
    const apps = dal.getApps();
    await runGitHubEvidenceSync({
      apps,
      userId: settings.sync_user_id,
      githubToken: githubAuth.token,
      mode: "scheduled",
      rangeDays: settings.observation_window_days,
      maxPrs: 50,
    });
    dal.setSetting(LAST_SCHEDULED_SYNC_SETTING, new Date().toISOString());
  } catch (error) {
    logger.error({ err: error }, "scheduled GitHub outcome evidence sync failed");
  } finally {
    schedulerRunning = false;
  }
}

export function startOutcomesGitHubSyncScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    runScheduledSyncIfDue().catch((error) => {
      logger.error({ err: error }, "outcomes GitHub sync scheduler tick failed");
    });
  }, SCHEDULER_TICK_MS);
}

export function stopOutcomesGitHubSyncScheduler(): void {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}
