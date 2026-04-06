import { logger } from "../logger";
import * as dal from "../dal";
import { automationDefinitions } from "./registry";
import { runAutomation } from "./runner";
import { seedAutomationDefaults } from "./seed";

const TICK_MS = 60_000; // 1 minute
let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Parse a simple cron expression into { hour, dayOfWeek }.
 * Supports basic patterns:
 *  - "0 22 * * *"    → daily at 22:00 UTC
 *  - "0 9 * * 1"     → weekly Monday at 09:00 UTC (0=Sun, 1=Mon, ...)
 */
function parseCronSchedule(cron: string): { hour: number; dayOfWeek: number | null } {
  const parts = cron.trim().split(/\s+/);
  const hour = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
  const dowStr = parts.length >= 5 ? parts[4] : "*";
  let dayOfWeek = dowStr !== "*" ? parseInt(dowStr, 10) : null;
  // Normalize 7 → 0 (both mean Sunday; JS Date.getUTCDay() only returns 0–6)
  if (dayOfWeek === 7) dayOfWeek = 0;

  return { hour: isNaN(hour) ? 0 : hour, dayOfWeek: dayOfWeek !== null && isNaN(dayOfWeek) ? null : dayOfWeek };
}

/**
 * Check if an automation is due to run based on its schedule and last_run_at.
 * Uses actual cron semantics: check hour, check day-of-week, and ensure
 * at least 20 hours have passed since the last scheduled run to prevent duplicates.
 */
function isDue(cronExpression: string, lastRunAt: string | null): boolean {
  const { hour, dayOfWeek } = parseCronSchedule(cronExpression);
  const now = new Date();

  // Must match the scheduled hour
  if (now.getUTCHours() !== hour) return false;

  // Must match the scheduled day-of-week (if specified)
  if (dayOfWeek !== null && now.getUTCDay() !== dayOfWeek) return false;

  // If never ran, it's due
  if (!lastRunAt) return true;

  // Prevent re-running within the same day (20h buffer)
  const elapsed = now.getTime() - new Date(lastRunAt).getTime();
  return elapsed >= 20 * 60 * 60 * 1000;
}

async function tick(): Promise<void> {
  for (const definition of automationDefinitions) {
    try {
      const enabledConfigs = dal.getEnabledConfigs(definition.key);

      for (const config of enabledConfigs) {
        const cron = config.cron_expression || definition.defaultCron;
        if (!isDue(cron, config.last_run_at)) continue;

        // Fire and forget — runner handles its own error recording
        runAutomation(config.app_id, definition.key).catch((err) => {
          logger.error({ err, automation: definition.key, appId: config.app_id }, "scheduler dispatch failed");
        });
      }
    } catch (err) {
      logger.error({ err, automation: definition.key }, "scheduler tick error");
    }
  }
}

/**
 * Ensure all existing apps have automation configs seeded.
 * This covers apps created before the automation system was deployed.
 */
function seedExistingApps(): void {
  try {
    const apps = dal.getApps();
    for (const app of apps) {
      seedAutomationDefaults(app.id);
    }
  } catch (err) {
    logger.error({ err }, "failed to seed automation configs for existing apps");
  }
}

export function startScheduler(): void {
  if (_timer) return;
  logger.info("automation scheduler started (tick every 60s)");

  // Seed configs for any apps that pre-date the automation system
  seedExistingApps();

  _timer = setInterval(() => {
    tick().catch((err) => {
      logger.error({ err }, "automation scheduler tick failed");
    });
  }, TICK_MS);
}

export function stopScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info("automation scheduler stopped");
  }
}
