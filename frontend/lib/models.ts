export const CLAUDE_MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

export interface ModelSelection {
  provider: string;
  model: string;
}

export const DEFAULT_PROVIDER = "claude";
