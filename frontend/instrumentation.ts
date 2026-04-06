export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWsServer } = await import("./lib/server/ws/server");
    startWsServer();

    // RFC 22: Mark any runs left in 'running' state from a previous crash
    const { markInterruptedRuns, clearAllLeases } = await import("./lib/server/dal");
    const count = markInterruptedRuns();
    if (count > 0) {
      const { logger } = await import("./lib/server/logger");
      logger.info({ count }, "marked stale runs as interrupted on startup");
    }

    // RFC 23: Clear stale automation leases from previous crash
    clearAllLeases();

    // RFC 23: Start the automation scheduler
    const { startScheduler } = await import("./lib/server/automations/scheduler");
    startScheduler();
  }
}
