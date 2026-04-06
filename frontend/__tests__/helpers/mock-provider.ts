/**
 * Mock AgentProvider for testing.
 * Implements the AgentProvider interface without real API calls.
 */
import type {
  AgentProvider,
  AgentStreamEvent,
  StreamTaskParams,
  ResumeSessionParams,
  EphemeralOpts,
  ToolStreamEvent,
  ModelEntry,
} from "@/lib/server/agent/types";

/** Yield events from an array as an async iterable. */
export async function* mockStream(events: AgentStreamEvent[]): AsyncIterable<AgentStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

/** Create a mock provider with sensible defaults. Override any method. */
export function createMockProvider(overrides?: Partial<AgentProvider>): AgentProvider {
  const defaultEvents: AgentStreamEvent[] = [
    { type: "session_id", sessionId: "mock-session-1" },
    { type: "text", text: "Mock response" },
    {
      type: "result",
      result: {
        text: "Mock response",
        sessionId: "mock-session-1",
        costUsd: 0.01,
        durationMs: 100,
        numTurns: 1,
        usage: { inputTokens: 100, outputTokens: 50 },
        models: ["mock-model"],
      },
    },
  ];

  return {
    id: "mock",
    label: "Mock Provider",
    streamTask: (_params: StreamTaskParams) => mockStream(defaultEvents),
    resumeSession: (_params: ResumeSessionParams) => mockStream(defaultEvents),
    ephemeralQuery: async (_prompt: string, _opts?: EphemeralOpts) => "mock response",
    toolEnabledStream: async function* (_prompt: string, _opts?: EphemeralOpts): AsyncGenerator<ToolStreamEvent> {
      yield { type: "text", detail: "mock tool response" };
      yield { type: "result", detail: "done", resultText: "mock result" };
    },
    listModels: (): ModelEntry[] => [{ id: "mock-model", label: "Mock Model", provider: "mock" }],
    isAvailable: async () => true,
    ...overrides,
  };
}

/** Create a provider that always errors. */
export function createFailingProvider(errorMessage = "Mock provider error"): AgentProvider {
  const errorEvents: AgentStreamEvent[] = [{ type: "error", error: errorMessage }];
  return createMockProvider({
    streamTask: () => mockStream(errorEvents),
    resumeSession: () => mockStream(errorEvents),
    ephemeralQuery: async () => { throw new Error(errorMessage); },
    isAvailable: async () => false,
  });
}
