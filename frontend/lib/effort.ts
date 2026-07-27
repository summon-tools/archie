export const EFFORT_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" },
] as const;

export type EffortLevel = (typeof EFFORT_OPTIONS)[number]["id"];

export const DEFAULT_EFFORT: EffortLevel = "high";

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && EFFORT_OPTIONS.some((option) => option.id === value);
}
