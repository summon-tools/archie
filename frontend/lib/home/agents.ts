export type HomeAgentKey = "coordinator" | "architect" | "implementer" | "reviewer" | "qa" | "security";

export interface HomeAgentDefinition {
  key: HomeAgentKey;
  name: string;
  role: string;
  defaultProvider: "claude" | "codex";
  defaultModel: string;
  planning: boolean;
  execution: boolean;
}

export const DEFAULT_HOME_AGENTS: HomeAgentDefinition[] = [
  {
    key: "coordinator",
    name: "Coordinator",
    role: "Owns the plan, execution state, progress updates, and handoffs between agents.",
    defaultProvider: "claude",
    defaultModel: "claude-sonnet-4-6",
    planning: true,
    execution: true,
  },
  {
    key: "architect",
    name: "Architect",
    role: "Shapes system design, ordering, tradeoffs, and architectural risk.",
    defaultProvider: "claude",
    defaultModel: "claude-opus-4-7",
    planning: true,
    execution: true,
  },
  {
    key: "implementer",
    name: "Implementer",
    role: "Makes scoped code changes through normal task conversations and worktrees.",
    defaultProvider: "codex",
    defaultModel: "gpt-5.5",
    planning: true,
    execution: true,
  },
  {
    key: "reviewer",
    name: "Reviewer",
    role: "Reviews diffs, behavior, regressions, and missing tests before a step advances.",
    defaultProvider: "claude",
    defaultModel: "claude-sonnet-4-6",
    planning: true,
    execution: true,
  },
  {
    key: "qa",
    name: "QA",
    role: "Validates acceptance criteria, test coverage, and browser behavior.",
    defaultProvider: "claude",
    defaultModel: "claude-sonnet-4-6",
    planning: true,
    execution: true,
  },
  {
    key: "security",
    name: "Security",
    role: "Checks auth, data exposure, secrets, unsafe execution, dependency risk, and permissions.",
    defaultProvider: "claude",
    defaultModel: "claude-opus-4-7",
    planning: true,
    execution: true,
  },
];

export function getHomeAgent(key: HomeAgentKey): HomeAgentDefinition {
  const agent = DEFAULT_HOME_AGENTS.find((candidate) => candidate.key === key);
  if (!agent) throw new Error(`Unknown room agent: ${key}`);
  return agent;
}
