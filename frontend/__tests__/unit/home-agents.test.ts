import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_AGENTS, GATE_FEEDBACK_CONTRACT, ROOM_AGENT_OPERATING_CONTRACT, getHomeAgent } from "@/lib/home/agents";

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

  it("applies the shared room operating contract to every default agent", () => {
    for (const agent of DEFAULT_HOME_AGENTS) {
      expect(agent.prompt).toContain(ROOM_AGENT_OPERATING_CONTRACT);
      expect(agent.prompt).toContain("operate read-only");
      expect(agent.prompt).toContain("Do not silently expand scope");
    }
  });

  it("uses a common feedback contract for review-oriented agents", () => {
    for (const key of ["architect", "reviewer", "qa", "security"] as const) {
      expect(getHomeAgent(key).prompt).toContain(GATE_FEEDBACK_CONTRACT);
      expect(getHomeAgent(key).prompt).toContain("Verdict: pass | needs_fixes");
    }
  });

  it("gives the coordinator explicit decision categories", () => {
    const prompt = getHomeAgent("coordinator").prompt;

    expect(prompt).toContain("mechanical choices");
    expect(prompt).toContain("taste choices");
    expect(prompt).toContain("user challenges");
    expect(prompt).toContain("blockers");
  });

  it("keeps specialist prompts grounded in their review responsibilities", () => {
    expect(getHomeAgent("architect").prompt).toContain("Map each proposed sub-problem to the existing code paths");
    expect(getHomeAgent("implementer").prompt).toContain("End with a concise handoff");
    expect(getHomeAgent("reviewer").prompt).toContain("Prioritize concrete bugs");
    expect(getHomeAgent("qa").prompt).toContain("Always map changed behavior to validation");
    expect(getHomeAgent("security").prompt).toContain("Check new or changed attack surface");
  });

  it("looks up agents by key", () => {
    expect(getHomeAgent("security").name).toBe("Security");
    expect(getHomeAgent("coordinator").name).toBe("Coordinator");
  });
});
