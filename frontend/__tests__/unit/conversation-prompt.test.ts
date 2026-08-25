import { describe, expect, it } from "vitest";
import { buildConversationSystemPromptBase } from "@/lib/server/prompts/conversation";

describe("conversation system prompt", () => {
  it("includes the primary project description and uses dependencies for any relevant task", () => {
    const prompt = buildConversationSystemPromptBase({
      appName: "Storefront",
      directory: "/tmp/storefront",
      appDescription: "The customer-facing commerce application.",
    });

    expect(prompt).toContain("Project description: The customer-facing commerce application.");
    expect(prompt).toContain("whenever a dependency is relevant to the current task");
    expect(prompt).toContain("Use each dependency's role and relationship purpose to decide when it is relevant");
    expect(prompt).not.toContain("before implementing an integration");
  });
});
