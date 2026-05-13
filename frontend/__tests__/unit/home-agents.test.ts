import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_AGENTS, getHomeAgent } from "@/lib/home/agents";

describe("default room agents", () => {
  it("ships the fixed V1 agent team", () => {
    expect(DEFAULT_HOME_AGENTS.map((agent) => agent.key)).toEqual([
      "coordinator",
      "architect",
      "implementer",
      "reviewer",
      "qa",
      "security",
    ]);
  });

  it("includes model and prompt defaults for every default agent", () => {
    for (const agent of DEFAULT_HOME_AGENTS) {
      expect(agent.defaultModel).toBeTruthy();
      expect(agent.prompt).toBeTruthy();
    }
  });

  it("looks up agents by key", () => {
    expect(getHomeAgent("security").name).toBe("Security");
    expect(getHomeAgent("coordinator").name).toBe("Coordinator");
  });
});
