export const CLAUDE_MODELS = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
] as const;

export const DEFAULT_MODEL_ID = "claude-opus-5";

export interface ModelSelection {
  provider: string;
  model: string;
}

export const DEFAULT_PROVIDER = "claude";
