import type { AppRow } from "../types";

export interface AutomationDefinition {
  key: string;
  name: string;
  description: string;
  defaultCron: string;
  defaultEnabled: boolean;
  execute(ctx: AutomationContext): Promise<AutomationResult>;
}

export interface AutomationContext {
  appId: number;
  app: AppRow;
  runId: number;
  config: Record<string, unknown>;
  automationUserId: number;
  /** ISO timestamp of last successful run, or null if never ran */
  lastRunAt: string | null;
}

export interface AutomationResult {
  status: "completed" | "skipped" | "failed";
  summary: string;
  notificationsCreated: number;
  workItemsCreated: number;
}
