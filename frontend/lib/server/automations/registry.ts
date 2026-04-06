import type { AutomationDefinition } from "./types";
import { completedWorkReviewAutomation } from "./definitions/completed-work-review";
import { specDriftReviewAutomation } from "./definitions/spec-drift-review";

export const automationDefinitions: AutomationDefinition[] = [
  completedWorkReviewAutomation,
  specDriftReviewAutomation,
];

export function getAutomationDefinition(key: string): AutomationDefinition | undefined {
  return automationDefinitions.find((d) => d.key === key);
}

export function getAllAutomationKeys(): string[] {
  return automationDefinitions.map((d) => d.key);
}
