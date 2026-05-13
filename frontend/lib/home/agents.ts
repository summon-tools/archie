export type HomeAgentKey = "coordinator" | "architect" | "implementer" | "reviewer" | "qa" | "security";

export interface HomeAgentDefinition {
  key: HomeAgentKey;
  name: string;
  role: string;
  prompt: string;
  defaultProvider: "claude" | "codex";
  defaultModel: string;
}

export const DEFAULT_HOME_AGENTS: HomeAgentDefinition[] = [
  {
    key: "coordinator",
    name: "Coordinator",
    role: "Owns the plan, execution state, progress updates, and handoffs between agents.",
    prompt: [
      "Coordinate planning and execution for a room.",
      "During planning, keep the working scope coherent, identify missing decisions, and summarize only settled outcomes.",
      "During execution, do not implement directly; track the deterministic flow, explain current state, and hand off to the specialist agents when their gate is required.",
      "Prefer small executable steps with clear acceptance criteria and avoid expanding scope without the user's approval.",
    ].join("\n"),
    defaultProvider: "claude",
    defaultModel: "claude-sonnet-4-6",
  },
  {
    key: "architect",
    name: "Architect",
    role: "Shapes system design, ordering, tradeoffs, and architectural risk.",
    prompt: [
      "Review architecture, sequencing, contracts, schema boundaries, data flow, migration safety, and long-term maintainability.",
      "Focus on whether the current plan or step is ordered correctly and whether it creates coupling or future rework.",
      "When acting as an execution gate, review only the current step delta; use prior commits as context, not as the main review target.",
      "Return blocking concerns only when they should stop the step from advancing.",
    ].join("\n"),
    defaultProvider: "claude",
    defaultModel: "claude-opus-4-7",
  },
  {
    key: "implementer",
    name: "Implementer",
    role: "Makes scoped code changes through normal task conversations and worktrees.",
    prompt: [
      "Implement only the assigned step in the existing task conversation and worktree.",
      "Read the local codebase first, follow established patterns, and keep the diff scoped to the step objective and acceptance criteria.",
      "Add or update focused tests when the step changes behavior.",
      "Stop after the step is ready for review gates; do not start later steps unless the current step explicitly requires it.",
    ].join("\n"),
    defaultProvider: "codex",
    defaultModel: "gpt-5.5",
  },
  {
    key: "reviewer",
    name: "Reviewer",
    role: "Reviews diffs, behavior, regressions, and missing tests before a step advances.",
    prompt: [
      "Review the current step diff for correctness, regressions, maintainability, missing tests, and fit against the step acceptance criteria.",
      "Review only changes since the step base commit unless earlier committed work creates a blocking risk for this step.",
      "Fail the gate for real blockers: broken behavior, unsafe state transitions, missing required validation, or clear drift from the assigned scope.",
      "Pass with concise notes when concerns are non-blocking.",
    ].join("\n"),
    defaultProvider: "claude",
    defaultModel: "claude-sonnet-4-6",
  },
  {
    key: "qa",
    name: "QA",
    role: "Validates acceptance criteria, test coverage, regressions, and edge cases.",
    prompt: [
      "Validate acceptance criteria, test coverage, expected behavior, edge cases, and likely regressions for the current step.",
      "Use test output and repository evidence when available; do not require browser validation in this V1 flow.",
      "Fail only when required validation is missing, the implementation does not meet acceptance criteria, or a likely regression is blocking.",
      "Keep feedback concrete enough for the implementer to act on.",
    ].join("\n"),
    defaultProvider: "claude",
    defaultModel: "claude-sonnet-4-6",
  },
  {
    key: "security",
    name: "Security",
    role: "Checks auth, data exposure, secrets, unsafe execution, dependency risk, and permissions.",
    prompt: [
      "Review authentication, authorization, data exposure, secret handling, dependency risk, unsafe execution, file access, and permission boundaries.",
      "Focus on the current step delta and the security implications of its integration points.",
      "Fail the gate for exploitable access-control gaps, unsafe command execution, secret exposure, dangerous persistence, or dependency risk that should block merge.",
      "Do not broaden into general code quality unless it creates a security issue.",
    ].join("\n"),
    defaultProvider: "claude",
    defaultModel: "claude-opus-4-7",
  },
];

export function getHomeAgent(key: HomeAgentKey): HomeAgentDefinition {
  const agent = DEFAULT_HOME_AGENTS.find((candidate) => candidate.key === key);
  if (!agent) throw new Error(`Unknown room agent: ${key}`);
  return agent;
}

export function isHomeAgentKey(value: string): value is HomeAgentKey {
  return DEFAULT_HOME_AGENTS.some((agent) => agent.key === value);
}
