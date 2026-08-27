export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs"
    || process.env.NODE_ENV === "test"
    || process.env.NEXT_PHASE === "phase-production-build"
  ) return;

  const { startWsServer } = await import("./lib/server/ws/server");
  startWsServer();

  // RFC 22: Mark any runs left in 'running' state from a previous crash.
  const { markInterruptedRuns, clearAllLeases } = await import("./lib/server/dal");
  const count = markInterruptedRuns();
  if (count > 0) {
    const { logger } = await import("./lib/server/logger");
    logger.info({ count }, "marked stale runs as interrupted on startup");
  }

  // RFC 23: Clear stale automation leases and start background schedulers.
  clearAllLeases();
  const { startScheduler } = await import("./lib/server/automations/scheduler");
  startScheduler();
  const { startOutcomesGitHubSyncScheduler } = await import("./lib/server/outcomes-github-sync");
  startOutcomesGitHubSyncScheduler();

  const [{ startPullRequestReviewWorker, sweepReviewWorktreesOnStartup }, { startReviewThreadWorker }] = await Promise.all([
    import("@/lib/server/pull-request-review-jobs"),
    import("@/lib/server/review-thread-jobs"),
  ]);
  const reviewWorktreeSweep = sweepReviewWorktreesOnStartup();
  if (reviewWorktreeSweep.removed > 0 || reviewWorktreeSweep.warnings.length > 0) {
    const { logger } = await import("./lib/server/logger");
    if (reviewWorktreeSweep.removed > 0) {
      logger.info({ removed: reviewWorktreeSweep.removed }, "removed orphaned review worktrees on startup");
    }
    if (reviewWorktreeSweep.warnings.length > 0) {
      logger.warn({ warnings: reviewWorktreeSweep.warnings }, "review worktree startup sweep completed with warnings");
    }
  }
  startPullRequestReviewWorker();
  startReviewThreadWorker();
}
