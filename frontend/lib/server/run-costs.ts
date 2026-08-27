import type { RunRow } from "@/lib/server/types";

export type CostSource = "reported" | "estimated" | "unknown";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface CostMetaRecord {
  message_id: number;
  body_md: string;
  created_at: string;
}

export interface ResolvedRunCost {
  amountUsd: number | null;
  source: CostSource;
  usage: TokenUsage | null;
}

export interface RunCostSummary {
  knownCost: number | null;
  reportedCost: number;
  estimatedCost: number;
  unknownCostRuns: number;
  reportedCostRuns: number;
  estimatedCostRuns: number;
}

type PricingRate = {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const PRICING_ENV = "ARCHIE_MODEL_PRICING_JSON";

// Fallback estimator for Codex runs that expose usage but not provider-reported cost.
// Reported costs always win over estimates.
const DEFAULT_MODEL_PRICING: Array<{
  providerId: string;
  modelId: string;
  rate: PricingRate;
}> = [
  {
    providerId: "codex",
    modelId: "gpt-5.6-sol",
    rate: { inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 30 },
  },
  {
    providerId: "codex",
    modelId: "gpt-5.6-terra",
    rate: { inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 0.25, outputUsdPerMillion: 15 },
  },
  {
    providerId: "codex",
    modelId: "gpt-5.6-luna",
    rate: { inputUsdPerMillion: 1, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 6 },
  },
  {
    providerId: "codex",
    modelId: "gpt-5.5",
    rate: { inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 30 },
  },
  {
    providerId: "codex",
    modelId: "gpt-5.4",
    rate: { inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 0.25, outputUsdPerMillion: 15 },
  },
  {
    providerId: "codex",
    modelId: "gpt-5.4-mini",
    rate: { inputUsdPerMillion: 0.75, cachedInputUsdPerMillion: 0.075, outputUsdPerMillion: 4.5 },
  },
];

function readFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readNumericField(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = readFiniteNumber(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeModelId(modelId: string | null): string {
  return String(modelId || "").trim().toLowerCase();
}

function normalizeProviderId(providerId: string | null): string {
  return String(providerId || "").trim().toLowerCase();
}

function readPricingRate(value: unknown): PricingRate | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const inputUsdPerMillion = readNumericField(object, [
    "inputUsdPerMillion",
    "input_usd_per_million",
    "input",
  ]);
  const cachedInputUsdPerMillion = readNumericField(object, [
    "cachedInputUsdPerMillion",
    "cached_input_usd_per_million",
    "cachedInput",
    "cached_input",
  ]);
  const outputUsdPerMillion = readNumericField(object, [
    "outputUsdPerMillion",
    "output_usd_per_million",
    "output",
  ]);
  if (inputUsdPerMillion === null || outputUsdPerMillion === null) return null;
  return {
    inputUsdPerMillion,
    cachedInputUsdPerMillion: cachedInputUsdPerMillion ?? inputUsdPerMillion,
    outputUsdPerMillion,
  };
}

function getConfiguredPricingRate(providerId: string, modelId: string): PricingRate | null {
  const raw = process.env[PRICING_ENV];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const object = parsed as Record<string, unknown>;
    return readPricingRate(object[`${providerId}:${modelId}`])
      || readPricingRate(object[modelId])
      || null;
  } catch {
    return null;
  }
}

function getPricingRate(providerId: string | null, modelId: string | null): PricingRate | null {
  const provider = normalizeProviderId(providerId);
  const model = normalizeModelId(modelId);
  if (!provider || !model) return null;

  const configured = getConfiguredPricingRate(provider, model);
  if (configured) return configured;

  const exact = DEFAULT_MODEL_PRICING.find((entry) => entry.providerId === provider && entry.modelId === model);
  if (exact) return exact.rate;

  if (provider === "codex" && model.startsWith("gpt-5.4-mini")) {
    return DEFAULT_MODEL_PRICING.find((entry) => entry.providerId === "codex" && entry.modelId === "gpt-5.4-mini")?.rate || null;
  }
  if (provider === "codex" && model.startsWith("gpt-5.4")) {
    return DEFAULT_MODEL_PRICING.find((entry) => entry.providerId === "codex" && entry.modelId === "gpt-5.4")?.rate || null;
  }
  if (provider === "codex" && model.startsWith("gpt-5.5")) {
    return DEFAULT_MODEL_PRICING.find((entry) => entry.providerId === "codex" && entry.modelId === "gpt-5.5")?.rate || null;
  }
  if (provider === "codex" && model.startsWith("gpt-5.6-sol")) {
    return DEFAULT_MODEL_PRICING.find((entry) => entry.providerId === "codex" && entry.modelId === "gpt-5.6-sol")?.rate || null;
  }
  if (provider === "codex" && model.startsWith("gpt-5.6-terra")) {
    return DEFAULT_MODEL_PRICING.find((entry) => entry.providerId === "codex" && entry.modelId === "gpt-5.6-terra")?.rate || null;
  }
  if (provider === "codex" && model.startsWith("gpt-5.6-luna")) {
    return DEFAULT_MODEL_PRICING.find((entry) => entry.providerId === "codex" && entry.modelId === "gpt-5.6-luna")?.rate || null;
  }

  return null;
}

function estimateCostUsd(providerId: string | null, modelId: string | null, usage: TokenUsage | null): number | null {
  if (!usage) return null;
  const rate = getPricingRate(providerId, modelId);
  if (!rate) return null;

  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncachedInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);

  return (
    (uncachedInputTokens / 1_000_000) * rate.inputUsdPerMillion +
    (cachedInputTokens / 1_000_000) * rate.cachedInputUsdPerMillion +
    (usage.outputTokens / 1_000_000) * rate.outputUsdPerMillion
  );
}

export function resolveModelCost(input: {
  providerId: string | null;
  modelId: string | null;
  reportedCostUsd: number | null;
  usage: TokenUsage | null;
}): ResolvedRunCost {
  if (input.reportedCostUsd !== null && Number.isFinite(input.reportedCostUsd) && input.reportedCostUsd >= 0) {
    return { amountUsd: input.reportedCostUsd, source: "reported", usage: input.usage };
  }
  const estimated = estimateCostUsd(input.providerId, input.modelId, input.usage);
  if (estimated !== null) return { amountUsd: estimated, source: "estimated", usage: input.usage };
  return { amountUsd: null, source: "unknown", usage: input.usage };
}

function parseUsageObject(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const inputTokens = readNumericField(object, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
  ]);
  const outputTokens = readNumericField(object, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
  ]);
  if (inputTokens === null && outputTokens === null) return null;

  const cachedInputTokens = readNumericField(object, [
    "cachedInputTokens",
    "cached_input_tokens",
    "cacheReadInputTokens",
    "cache_read_input_tokens",
  ]) || 0;

  return {
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    cachedInputTokens,
  };
}

function parseResultJson(resultJson: string | null): {
  reportedCostUsd: number | null;
  usage: TokenUsage | null;
} {
  if (!resultJson) return { reportedCostUsd: null, usage: null };
  try {
    const parsed = JSON.parse(resultJson);
    if (!parsed || typeof parsed !== "object") return { reportedCostUsd: null, usage: null };
    const object = parsed as Record<string, unknown>;
    const reportedCostUsd = readNumericField(object, [
      "cost",
      "costUsd",
      "cost_usd",
      "totalCostUsd",
      "total_cost_usd",
    ]);
    const usage = parseUsageObject(object.usage)
      || parseUsageObject(object.token_usage)
      || parseUsageObject(object.tokens)
      || parseUsageObject(object);
    return { reportedCostUsd, usage };
  } catch {
    return { reportedCostUsd: null, usage: null };
  }
}

function parseMetaBody(bodyMd: string): {
  reportedCostUsd: number | null;
  usage: TokenUsage | null;
} | null {
  const matches = [...bodyMd.matchAll(/<!--\s*meta:\s*([\s\S]*?)-->/g)];
  const latest = matches[matches.length - 1]?.[1];
  if (!latest) return null;

  const reportedCostMatch = latest.match(/(?:^|\|)\s*cost=\$?([0-9]+(?:\.[0-9]+)?)/);
  const inputMatch = latest.match(/(?:^|\|)\s*in=([0-9]+)/);
  const outputMatch = latest.match(/(?:^|\|)\s*out=([0-9]+)/);

  const reportedCostUsd = reportedCostMatch ? Number(reportedCostMatch[1]) : null;
  const inputTokens = inputMatch ? Number(inputMatch[1]) : null;
  const outputTokens = outputMatch ? Number(outputMatch[1]) : null;
  const usage = inputTokens !== null || outputTokens !== null
    ? {
      inputTokens: Number.isFinite(inputTokens) ? inputTokens || 0 : 0,
      outputTokens: Number.isFinite(outputTokens) ? outputTokens || 0 : 0,
      cachedInputTokens: 0,
    }
    : null;

  return {
    reportedCostUsd: reportedCostUsd !== null && Number.isFinite(reportedCostUsd) && reportedCostUsd >= 0
      ? reportedCostUsd
      : null,
    usage,
  };
}

function resolveRunCost(run: RunRow, meta: CostMetaRecord | null): ResolvedRunCost {
  const parsed = parseResultJson(run.result_json);
  if (parsed.reportedCostUsd !== null) {
    return { amountUsd: parsed.reportedCostUsd, source: "reported", usage: parsed.usage };
  }

  const parsedMeta = meta ? parseMetaBody(meta.body_md) : null;
  if (parsedMeta?.reportedCostUsd !== null && parsedMeta?.reportedCostUsd !== undefined) {
    return { amountUsd: parsedMeta.reportedCostUsd, source: "reported", usage: parsedMeta.usage || parsed.usage };
  }

  const usage = parsed.usage || parsedMeta?.usage || null;
  const estimatedCostUsd = estimateCostUsd(run.provider_id, run.model_id, usage);
  if (estimatedCostUsd !== null) {
    return { amountUsd: estimatedCostUsd, source: "estimated", usage };
  }

  return { amountUsd: null, source: "unknown", usage };
}

export function summarizeRunCosts(runs: RunRow[], metaRecords: CostMetaRecord[] = []): RunCostSummary {
  let knownCost = 0;
  let hasKnownCost = false;
  let reportedCost = 0;
  let estimatedCost = 0;
  let unknownCostRuns = 0;
  let reportedCostRuns = 0;
  let estimatedCostRuns = 0;

  const sortedRuns = [...runs].sort((left, right) => left.id - right.id);
  const sortedMeta = [...metaRecords].sort((left, right) => left.message_id - right.message_id);
  let metaIndex = 0;

  for (const run of sortedRuns) {
    const canUseMeta = run.status === "completed" && (!run.workflow_key || run.workflow_key === "stream");
    const meta = canUseMeta ? sortedMeta[metaIndex] || null : null;
    const resolved = resolveRunCost(run, meta);
    if (meta && canUseMeta) metaIndex += 1;

    if (resolved.amountUsd === null) {
      unknownCostRuns += 1;
      continue;
    }

    hasKnownCost = true;
    knownCost += resolved.amountUsd;
    if (resolved.source === "estimated") {
      estimatedCost += resolved.amountUsd;
      estimatedCostRuns += 1;
    } else {
      reportedCost += resolved.amountUsd;
      reportedCostRuns += 1;
    }
  }

  return {
    knownCost: hasKnownCost ? knownCost : null,
    reportedCost,
    estimatedCost,
    unknownCostRuns,
    reportedCostRuns,
    estimatedCostRuns,
  };
}
