/**
 * Ephemeral job tracker for short-lived background tasks.
 * Auto-expires after a configurable TTL. Used for tasks like
 * spec-change evaluation that run for a few seconds.
 */

const _g = globalThis as any;

interface EphemeralJob {
  id: string;
  app_id: number;
  type: string;
  label: string;
  started_at: number;
  expires_at: number;
}

const _jobs: Map<string, EphemeralJob> = _g.__ephemeralJobs ??= new Map();

const DEFAULT_TTL_MS = 30_000; // 30 seconds

export function addEphemeralJob(job: Omit<EphemeralJob, "expires_at">, ttlMs = DEFAULT_TTL_MS): void {
  _jobs.set(job.id, { ...job, expires_at: Date.now() + ttlMs });
}

export function removeEphemeralJob(id: string): void {
  _jobs.delete(id);
}

export function getEphemeralJobs(): EphemeralJob[] {
  const now = Date.now();
  const result: EphemeralJob[] = [];
  for (const [id, job] of _jobs) {
    if (now > job.expires_at) {
      _jobs.delete(id);
    } else {
      result.push(job);
    }
  }
  return result;
}
