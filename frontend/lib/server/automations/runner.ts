import { logger } from "../logger";
import * as dal from "../dal";
import { getAutomationDefinition } from "./registry";
import { getAutomationUserId } from "./system-user";
import type { AutomationContext, AutomationResult } from "./types";

/**
 * Compute a window key for lease deduplication.
 * Uses the current UTC date + hour so the same window can't run twice.
 */
function computeWindowKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;
}

/**
 * Run a single automation for an app.
 * Uses an atomic SQLite lease to prevent duplicate concurrent runs,
 * then creates a durable `runs` row, executes the definition, and records the outcome.
 */
export async function runAutomation(appId: number, automationKey: string, opts?: { manual?: boolean }): Promise<void> {
  const log = logger.child({ automation: automationKey, appId });

  const definition = getAutomationDefinition(automationKey);
  if (!definition) {
    log.warn("unknown automation key");
    return;
  }

  const app = dal.getApp(appId);
  if (!app) {
    log.warn("app not found");
    return;
  }

  const config = dal.getAutomationConfig(appId, automationKey);
  const parsedConfig = config?.config_json ? JSON.parse(config.config_json) : {};

  // Create durable run record
  const run = dal.createRun({
    app_id: appId,
    workflow_key: `automation:${automationKey}`,
    status: "running",
    progress_text: `Running ${definition.name}...`,
  });

  // Atomically acquire a lease for this window.
  // If another process already created a run for this (app, key, window), bail out.
  const windowKey = computeWindowKey();
  const acquired = dal.tryAcquireLease(appId, automationKey, windowKey, run.id);
  if (!acquired) {
    log.debug("skipping — lease already held for this window");
    dal.updateRun(run.id, { status: "stopped", error_text: "duplicate: lease already held" });
    return;
  }

  const ctx: AutomationContext = {
    appId,
    app,
    runId: run.id,
    config: parsedConfig,
    automationUserId: getAutomationUserId(),
    lastRunAt: config?.last_run_at ?? null,
  };

  // "completed" and "skipped" both advance last_run_at; "failed" does not,
  // so the scheduler can retry the automation in the next window.
  let advanceWindow = false;
  try {
    const result = await definition.execute(ctx);

    if (result.status === "failed") {
      dal.updateRun(run.id, {
        status: "failed",
        error_text: result.summary,
        result_json: JSON.stringify(result),
      });
      log.warn({ status: result.status }, `automation reported failure: ${result.summary}`);
    } else {
      dal.updateRun(run.id, {
        status: "completed",
        result_json: JSON.stringify(result),
        progress_text: result.summary,
      });
      log.info(
        { status: result.status, notifications: result.notificationsCreated, workItems: result.workItemsCreated },
        result.summary
      );
      advanceWindow = true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dal.updateRun(run.id, {
      status: "failed",
      error_text: message,
      failure_category: "automation_error",
    });
    log.error({ err }, `automation failed: ${message}`);
  } finally {
    // Release the lease so the window can be retried on failure
    dal.releaseLease(appId, automationKey, windowKey);
  }

  // Only advance last_run_at when the automation completed/skipped successfully
  // and this is a scheduled (not manual) run.
  if (advanceWindow && !opts?.manual) {
    dal.updateLastRunAt(appId, automationKey);
  }
}
