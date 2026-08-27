import { describe, expect, it } from "vitest";
import {
  combineReviewCostSummaries,
  modelCallCostFromAgentResult,
  parseReviewCostSummary,
  summarizeReviewModelCalls,
} from "@/lib/server/review-costs";

describe("review cost accounting", () => {
  it("prefers a provider-reported cost over an estimate", () => {
    const call = modelCallCostFromAgentResult({
      phase: "discover",
      providerId: "claude",
      modelId: "claude-sonnet-5",
      measuredDurationMs: 500,
      result: {
        text: "{}",
        sessionId: null,
        costUsd: 0.125,
        durationMs: 450,
        numTurns: 1,
        usage: { inputTokens: 1000, outputTokens: 100 },
        models: ["claude-sonnet-5"],
      },
    });

    expect(call).toMatchObject({ cost_usd: 0.125, cost_source: "reported", duration_ms: 450 });
  });

  it("estimates Codex spend from token usage and configured fallback pricing", () => {
    const call = modelCallCostFromAgentResult({
      phase: "verify",
      providerId: "codex",
      modelId: "gpt-5.5",
      measuredDurationMs: 500,
      result: {
        text: "{}",
        sessionId: null,
        costUsd: null,
        durationMs: null,
        numTurns: 1,
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 500_000 },
        models: [],
      },
    });

    expect(call).toMatchObject({
      cost_usd: 32.75,
      cost_source: "estimated",
      usage: { cached_input_tokens: 500_000 },
    });
  });

  it("keeps historical runs unknown when they have no usage", () => {
    const historical = parseReviewCostSummary(JSON.stringify({
      model_calls: 2,
      cost_usd: null,
      usage: null,
      cost_status: "unavailable_from_ephemeral_provider",
    }), 2);

    expect(historical).toMatchObject({
      model_calls: 2,
      known_cost_usd: 0,
      unknown_cost_calls: 2,
      cost_source: "unknown",
    });
  });

  it("discloses partial totals when known and unknown calls are combined", () => {
    const reported = summarizeReviewModelCalls([{
      phase: "discover",
      provider_id: "claude",
      model_id: "claude-sonnet-5",
      duration_ms: 100,
      cost_usd: 0.05,
      cost_source: "reported",
      usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 0 },
    }]);
    const unknown = parseReviewCostSummary(null, 1);

    expect(combineReviewCostSummaries([reported, unknown])).toMatchObject({
      model_calls: 2,
      known_cost_usd: 0.05,
      unknown_cost_calls: 1,
      cost_source: "partial",
    });
  });
});
