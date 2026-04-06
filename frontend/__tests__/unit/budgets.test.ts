import { describe, it, expect } from "vitest";
import { getBudget, checkBudget } from "@/lib/server/knowledge/budgets";

describe("getBudget", () => {
  it("returns defaults for known workflow", () => {
    const budget = getBudget("stream");
    expect(budget.max_turns).toBe(50);
    expect(budget.max_duration_ms).toBe(600000);
    expect(budget.max_cost_usd).toBe(5.0);
  });

  it("returns seed budget", () => {
    const budget = getBudget("seed");
    expect(budget.max_turns).toBe(20);
    expect(budget.max_cost_usd).toBe(1.0);
  });

  it("falls back to stream defaults for unknown workflow", () => {
    const budget = getBudget("nonexistent_workflow");
    expect(budget.max_turns).toBe(50);
    expect(budget.max_duration_ms).toBe(600000);
  });

  it("applies overrides", () => {
    const budget = getBudget("stream", { max_turns: 10 });
    expect(budget.max_turns).toBe(10);
    expect(budget.max_duration_ms).toBe(600000); // unchanged
    expect(budget.max_cost_usd).toBe(5.0); // unchanged
  });

  it("returns a copy, not the original object", () => {
    const a = getBudget("stream");
    const b = getBudget("stream");
    a.max_turns = 999;
    expect(b.max_turns).toBe(50);
  });
});

describe("checkBudget", () => {
  const budget = getBudget("stream");

  it("returns not exceeded when under all limits", () => {
    const result = checkBudget(budget, { numTurns: 5, durationMs: 1000, costUsd: 0.01 });
    expect(result.exceeded).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("detects exceeded turns", () => {
    const result = checkBudget(budget, { numTurns: 51 });
    expect(result.exceeded).toBe(true);
    expect(result.reason).toContain("turns");
  });

  it("detects exceeded duration", () => {
    const result = checkBudget(budget, { durationMs: 700000 });
    expect(result.exceeded).toBe(true);
    expect(result.reason).toContain("duration");
  });

  it("detects exceeded cost", () => {
    const result = checkBudget(budget, { costUsd: 6.0 });
    expect(result.exceeded).toBe(true);
    expect(result.reason).toContain("cost");
  });

  it("returns not exceeded with empty metrics", () => {
    const result = checkBudget(budget, {});
    expect(result.exceeded).toBe(false);
  });

  it("returns not exceeded with zero metrics", () => {
    const result = checkBudget(budget, { numTurns: 0, durationMs: 0, costUsd: 0 });
    expect(result.exceeded).toBe(false);
  });

  it("returns not exceeded at exact limit", () => {
    // checkBudget uses > not >=, so exact limit is not exceeded
    const result = checkBudget(budget, { numTurns: 50 });
    expect(result.exceeded).toBe(false);
  });
});
