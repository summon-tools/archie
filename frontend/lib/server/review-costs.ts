import type { AgentResult } from "@/lib/server/agent";
import { resolveModelCost, type CostSource, type TokenUsage } from "@/lib/server/run-costs";

export type ReviewCostSource = CostSource | "mixed" | "partial";

export interface ReviewModelCallCost {
  phase: string;
  provider_id: string;
  model_id: string;
  duration_ms: number | null;
  cost_usd: number | null;
  cost_source: CostSource;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
  } | null;
}

export interface ReviewCostSummary {
  model_calls: number;
  known_cost_usd: number;
  reported_cost_usd: number;
  estimated_cost_usd: number;
  unknown_cost_calls: number;
  reported_cost_calls: number;
  estimated_cost_calls: number;
  cost_source: ReviewCostSource;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
  } | null;
  calls: ReviewModelCallCost[];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function integer(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.floor(parsed);
}

function publicUsage(usage: TokenUsage | null): ReviewModelCallCost["usage"] {
  if (!usage) return null;
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cached_input_tokens: usage.cachedInputTokens,
  };
}

export function modelCallCostFromAgentResult(input: {
  phase: string;
  providerId: string;
  modelId: string;
  result: AgentResult;
  measuredDurationMs: number;
}): ReviewModelCallCost {
  const usage: TokenUsage | null = input.result.usage
    ? {
      inputTokens: input.result.usage.inputTokens,
      outputTokens: input.result.usage.outputTokens,
      cachedInputTokens: input.result.usage.cachedInputTokens || 0,
    }
    : null;
  const resolved = resolveModelCost({
    providerId: input.providerId,
    modelId: input.modelId,
    reportedCostUsd: input.result.costUsd,
    usage,
  });
  return {
    phase: input.phase,
    provider_id: input.providerId,
    model_id: input.modelId,
    duration_ms: input.result.durationMs ?? input.measuredDurationMs,
    cost_usd: resolved.amountUsd,
    cost_source: resolved.source,
    usage: publicUsage(usage),
  };
}

function sourceFor(summary: Omit<ReviewCostSummary, "cost_source" | "usage" | "calls">): ReviewCostSource {
  const knownCalls = summary.reported_cost_calls + summary.estimated_cost_calls;
  if (summary.unknown_cost_calls > 0) return knownCalls > 0 ? "partial" : "unknown";
  if (summary.reported_cost_calls > 0 && summary.estimated_cost_calls > 0) return "mixed";
  if (summary.reported_cost_calls > 0) return "reported";
  if (summary.estimated_cost_calls > 0) return "estimated";
  return "unknown";
}

export function summarizeReviewModelCalls(calls: ReviewModelCallCost[]): ReviewCostSummary {
  const base = {
    model_calls: calls.length,
    known_cost_usd: 0,
    reported_cost_usd: 0,
    estimated_cost_usd: 0,
    unknown_cost_calls: 0,
    reported_cost_calls: 0,
    estimated_cost_calls: 0,
  };
  let hasUsage = false;
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  for (const call of calls) {
    if (call.cost_usd === null || call.cost_source === "unknown") {
      base.unknown_cost_calls += 1;
    } else if (call.cost_source === "reported") {
      base.known_cost_usd += call.cost_usd;
      base.reported_cost_usd += call.cost_usd;
      base.reported_cost_calls += 1;
    } else {
      base.known_cost_usd += call.cost_usd;
      base.estimated_cost_usd += call.cost_usd;
      base.estimated_cost_calls += 1;
    }
    if (call.usage) {
      hasUsage = true;
      usage.input_tokens += call.usage.input_tokens;
      usage.output_tokens += call.usage.output_tokens;
      usage.cached_input_tokens += call.usage.cached_input_tokens;
    }
  }
  return {
    ...base,
    cost_source: sourceFor(base),
    usage: hasUsage ? usage : null,
    calls,
  };
}

export function reviewCostPersistenceFields(summary: ReviewCostSummary): ReviewCostSummary & {
  cost_usd: number | null;
  cost_status: ReviewCostSource;
} {
  return {
    ...summary,
    cost_usd: summary.reported_cost_calls + summary.estimated_cost_calls > 0 ? summary.known_cost_usd : null,
    cost_status: summary.cost_source,
  };
}

export function combineReviewCostSummaries(summaries: ReviewCostSummary[]): ReviewCostSummary {
  const calls = summaries.flatMap((summary) => summary.calls);
  if (calls.length === summaries.reduce((sum, summary) => sum + summary.model_calls, 0)) {
    return summarizeReviewModelCalls(calls);
  }
  const base = summaries.reduce((combined, summary) => ({
    model_calls: combined.model_calls + summary.model_calls,
    known_cost_usd: combined.known_cost_usd + summary.known_cost_usd,
    reported_cost_usd: combined.reported_cost_usd + summary.reported_cost_usd,
    estimated_cost_usd: combined.estimated_cost_usd + summary.estimated_cost_usd,
    unknown_cost_calls: combined.unknown_cost_calls + summary.unknown_cost_calls,
    reported_cost_calls: combined.reported_cost_calls + summary.reported_cost_calls,
    estimated_cost_calls: combined.estimated_cost_calls + summary.estimated_cost_calls,
  }), {
    model_calls: 0,
    known_cost_usd: 0,
    reported_cost_usd: 0,
    estimated_cost_usd: 0,
    unknown_cost_calls: 0,
    reported_cost_calls: 0,
    estimated_cost_calls: 0,
  });
  const usageValues = summaries.map((summary) => summary.usage).filter(Boolean) as NonNullable<ReviewCostSummary["usage"]>[];
  return {
    ...base,
    cost_source: sourceFor(base),
    usage: usageValues.length ? usageValues.reduce((total, current) => ({
      input_tokens: total.input_tokens + current.input_tokens,
      output_tokens: total.output_tokens + current.output_tokens,
      cached_input_tokens: total.cached_input_tokens + current.cached_input_tokens,
    }), { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 }) : null,
    calls,
  };
}

function parseCall(value: unknown): ReviewModelCallCost | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const source = object.cost_source === "reported" || object.cost_source === "estimated" ? object.cost_source : "unknown";
  const usageObject = object.usage && typeof object.usage === "object" ? object.usage as Record<string, unknown> : null;
  const usage = usageObject ? {
    input_tokens: integer(usageObject.input_tokens) || 0,
    output_tokens: integer(usageObject.output_tokens) || 0,
    cached_input_tokens: integer(usageObject.cached_input_tokens) || 0,
  } : null;
  return {
    phase: typeof object.phase === "string" ? object.phase : "model",
    provider_id: typeof object.provider_id === "string" ? object.provider_id : "",
    model_id: typeof object.model_id === "string" ? object.model_id : "",
    duration_ms: finiteNumber(object.duration_ms),
    cost_usd: finiteNumber(object.cost_usd),
    cost_source: source,
    usage,
  };
}

export function parseReviewCostSummary(value: string | null, fallbackUnknownCalls = 0): ReviewCostSummary {
  let object: Record<string, unknown> = {};
  try {
    const parsed = value ? JSON.parse(value) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) object = parsed as Record<string, unknown>;
  } catch {}
  const calls = Array.isArray(object.calls) ? object.calls.map(parseCall).filter(Boolean) as ReviewModelCallCost[] : [];
  if (calls.length) return summarizeReviewModelCalls(calls);

  const modelCalls = integer(object.model_calls) ?? fallbackUnknownCalls;
  const knownCost = finiteNumber(object.known_cost_usd) ?? finiteNumber(object.cost_usd);
  const reportedCost = finiteNumber(object.reported_cost_usd) || 0;
  const estimatedCost = finiteNumber(object.estimated_cost_usd) || 0;
  const reportedCalls = integer(object.reported_cost_calls) || (knownCost !== null && object.cost_source === "reported" ? modelCalls : 0);
  const estimatedCalls = integer(object.estimated_cost_calls) || (knownCost !== null && object.cost_source === "estimated" ? modelCalls : 0);
  const explicitUnknown = integer(object.unknown_cost_calls);
  const unknownCalls = explicitUnknown ?? (knownCost === null ? modelCalls : Math.max(0, modelCalls - reportedCalls - estimatedCalls));
  const base = {
    model_calls: modelCalls,
    known_cost_usd: knownCost ?? reportedCost + estimatedCost,
    reported_cost_usd: reportedCost || (object.cost_source === "reported" ? knownCost || 0 : 0),
    estimated_cost_usd: estimatedCost || (object.cost_source === "estimated" ? knownCost || 0 : 0),
    unknown_cost_calls: unknownCalls,
    reported_cost_calls: reportedCalls,
    estimated_cost_calls: estimatedCalls,
  };
  const usageObject = object.usage && typeof object.usage === "object" ? object.usage as Record<string, unknown> : null;
  return {
    ...base,
    cost_source: sourceFor(base),
    usage: usageObject ? {
      input_tokens: integer(usageObject.input_tokens) || 0,
      output_tokens: integer(usageObject.output_tokens) || 0,
      cached_input_tokens: integer(usageObject.cached_input_tokens) || 0,
    } : null,
    calls: [],
  };
}
