import type { AutomationDefinition } from "./types";
import { completedWorkReviewAutomation } from "./definitions/completed-work-review";

export const automationDefinitions: AutomationDefinition[] = [
  completedWorkReviewAutomation,
];

export function getAutomationDefinition(key: string): AutomationDefinition | undefined {
  return automationDefinitions.find((d) => d.key === key);
}

export function getAllAutomationKeys(): string[] {
  return automationDefinitions.map((d) => d.key);
}
