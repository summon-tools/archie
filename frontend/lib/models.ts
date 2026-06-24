export const CLAUDE_MODELS = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
] as const;

export const DEFAULT_MODEL_ID = "claude-opus-4-8";

export interface ModelSelection {
  provider: string;
  model: string;
}

export const DEFAULT_PROVIDER = "claude";
