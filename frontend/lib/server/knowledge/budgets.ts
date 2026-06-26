/**
 * Run budgets — limits on turns, duration, and cost per workflow.
 */

export interface RunBudget {
  max_turns: number;
  max_duration_ms: number;
  max_cost_usd: number;
}

const DEFAULT_BUDGETS: Record<string, RunBudget> = {
  stream:        { max_turns: 50,  max_duration_ms: 600000, max_cost_usd: 5.0 },
  seed:          { max_turns: 20,  max_duration_ms: 120000, max_cost_usd: 1.0 },
  demo:          { max_turns: 30,  max_duration_ms: 300000, max_cost_usd: 2.0 },
  walkthrough:   { max_turns: 5,   max_duration_ms: 30000,  max_cost_usd: 0.5 },
};

/**
 * Get the budget for a workflow, with optional overrides.
 */
export function getBudget(workflow: string, overrides?: Partial<RunBudget>): RunBudget {
  const base = DEFAULT_BUDGETS[workflow] || DEFAULT_BUDGETS.stream;
  if (!overrides) return { ...base };
  return {
    max_turns: overrides.max_turns ?? base.max_turns,
    max_duration_ms: overrides.max_duration_ms ?? base.max_duration_ms,
    max_cost_usd: overrides.max_cost_usd ?? base.max_cost_usd,
  };
}

export interface BudgetCheckResult {
  exceeded: boolean;
  reason?: string;
}

/**
 * Check if a run has exceeded its budget.
 * `runResult` should contain the run's current metrics.
 */
export function checkBudget(
  budget: RunBudget,
  metrics: { numTurns?: number; durationMs?: number; costUsd?: number }
): BudgetCheckResult {
  if (metrics.numTurns && metrics.numTurns > budget.max_turns) {
    return { exceeded: true, reason: `Exceeded max turns (${metrics.numTurns}/${budget.max_turns})` };
  }
  if (metrics.durationMs && metrics.durationMs > budget.max_duration_ms) {
    return { exceeded: true, reason: `Exceeded max duration (${Math.round(metrics.durationMs / 1000)}s/${Math.round(budget.max_duration_ms / 1000)}s)` };
  }
  if (metrics.costUsd && metrics.costUsd > budget.max_cost_usd) {
    return { exceeded: true, reason: `Exceeded max cost ($${metrics.costUsd.toFixed(2)}/$${budget.max_cost_usd.toFixed(2)})` };
  }
  return { exceeded: false };
}
