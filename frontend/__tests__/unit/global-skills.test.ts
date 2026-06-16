import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";

describe("global skills DAL", () => {
  let ctx: TestContext;

  beforeEach(() => {
    vi.resetModules();
    ctx = createTestContext("archie-global-skills-");
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it("creates, lists, updates, and deletes global skills", async () => {
    await getTestDb(ctx);
    const dal = await import("@/lib/server/dal/global-skills");

    const created = dal.createGlobalSkill({
      slug: "Review Code",
      name: "Review Code",
      description: "Review implementation changes",
      body_md: "Findings first.",
      parts: [{ name: "Review checklist", body_md: "Check correctness and tests." }],
      trigger_phrases: ["review this", "check my changes", "review this"],
      enabled: true,
      created_by: null,
      updated_by: null,
    });

    expect(created.slug).toBe("review-code");
    expect(created.parts).toEqual([{ name: "Review checklist", body_md: "Check correctness and tests." }]);
    expect(created.trigger_phrases).toEqual(["review this", "check my changes"]);
    expect(dal.listGlobalSkills({ enabledOnly: true })).toHaveLength(1);

    const updated = dal.updateGlobalSkill("review-code", {
      slug: "review",
      enabled: false,
      parts: [{ name: "Release notes", body_md: "Mention verification commands." }],
      trigger_phrases: ["deep review"],
    });

    expect(updated?.slug).toBe("review");
    expect(updated?.enabled).toBe(false);
    expect(updated?.parts).toEqual([{ name: "Release notes", body_md: "Mention verification commands." }]);
    expect(updated?.trigger_phrases).toEqual(["deep review"]);
    expect(dal.listGlobalSkills({ enabledOnly: true })).toHaveLength(0);

    expect(dal.deleteGlobalSkill("review")).toBe(true);
    expect(dal.listGlobalSkills()).toHaveLength(0);
  });
});

describe("global skill prompt resolver", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  function mockSkills() {
    vi.doMock("@/lib/server/dal", () => ({
      listGlobalSkills: (opts?: { enabledOnly?: boolean }) => {
        const skills = [
          {
            id: 1,
            slug: "review",
            name: "Review Code",
            description: "Review implementation changes",
            body_md: "Findings first.",
            parts: [{ name: "Review checklist", body_md: "Check correctness and tests." }],
            trigger_phrases: ["review this", "check my changes"],
            enabled: true,
            created_by: null,
            updated_by: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
          {
            id: 2,
            slug: "tests",
            name: "Testing Plan",
            description: "Plan test coverage",
            body_md: "Name exact test commands.",
            parts: [],
            trigger_phrases: ["test coverage"],
            enabled: true,
            created_by: null,
            updated_by: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
          {
            id: 3,
            slug: "disabled-review",
            name: "Disabled Review",
            description: "Old review workflow",
            body_md: "This disabled instruction must not be used.",
            parts: [{ name: "Disabled part", body_md: "Do not include this." }],
            trigger_phrases: ["disabled review"],
            enabled: false,
            created_by: null,
            updated_by: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ];
        return opts?.enabledOnly ? skills.filter((skill) => skill.enabled) : skills;
      },
    }));
  }

  it("extracts explicit slash skill calls", async () => {
    mockSkills();
    const { extractSlashSkillSlugs } = await import("@/lib/server/global-skills");
    expect(extractSlashSkillSlugs("/review this change and /tests")).toEqual(["review", "tests"]);
  });

  it("injects active skill instructions for slash calls and trigger phrases", async () => {
    mockSkills();
    const { buildGlobalSkillPromptContext } = await import("@/lib/server/global-skills");

    const slashContext = buildGlobalSkillPromptContext("/review this implementation");
    expect(slashContext.promptText).toContain("Available global skills");
    expect(slashContext.activeSkills.map((skill) => skill.slug)).toEqual(["review"]);
    expect(slashContext.activeText).toContain("Findings first.");
    expect(slashContext.activeText).toContain('<global_skill_part name="Review checklist">');
    expect(slashContext.activeText).toContain("Check correctness and tests.");

    const triggerContext = buildGlobalSkillPromptContext("Can you check my changes?");
    expect(triggerContext.activeSkills.map((skill) => skill.slug)).toEqual(["review"]);
  });

  it("does not activate disabled skills from explicit slash calls", async () => {
    mockSkills();
    const { buildGlobalSkillPromptContext } = await import("@/lib/server/global-skills");

    const context = buildGlobalSkillPromptContext("/disabled-review this implementation");

    expect(context.activeSkills).toHaveLength(0);
    expect(context.disabledSlashSlugs).toEqual(["disabled-review"]);
    expect(context.activeText).not.toContain("This disabled instruction must not be used.");
    expect(context.promptText).toContain("Do not apply disabled skill instructions");
  });
});
