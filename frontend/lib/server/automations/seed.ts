import * as dal from "../dal";
import { automationDefinitions } from "./registry";

/**
 * Seed default automation configs for an app.
 * Called when a new app is created — inserts a row for each
 * registered automation definition if one doesn't already exist.
 */
export function seedAutomationDefaults(appId: number): void {
  for (const definition of automationDefinitions) {
    const existing = dal.getAutomationConfig(appId, definition.key);
    if (!existing) {
      dal.upsertAutomationConfig(appId, definition.key, {
        enabled: definition.defaultEnabled ? 1 : 0,
        cronExpression: definition.defaultCron,
      });
    }
  }
}
