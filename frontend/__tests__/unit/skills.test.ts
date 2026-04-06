import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { readSkillsIndex, ensureSkillsDir } from "@/lib/server/skills";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archie-skills-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeSkillsIndex(content: string) {
  const skillsDir = path.join(tmpDir, ".archie", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(path.join(skillsDir, "_index.md"), content);
}

describe("readSkillsIndex", () => {
  it("parses a well-formed _index.md", () => {
    writeSkillsIndex(`# Team Skills

- auth-testing.md: How we test auth flows
- deploy-checklist.md: Pre-deploy checklist
`);

    const result = readSkillsIndex(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries[0]).toEqual({
      filename: "auth-testing.md",
      name: "auth-testing",
      description: "How we test auth flows",
    });
  });

  it("returns null when _index.md is missing", () => {
    expect(readSkillsIndex(tmpDir)).toBeNull();
  });

  it("handles empty file", () => {
    writeSkillsIndex("");
    const result = readSkillsIndex(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(0);
  });
});

describe("ensureSkillsDir", () => {
  it("creates the .archie/skills directory", () => {
    ensureSkillsDir(tmpDir);
    const dirExists = fs.existsSync(path.join(tmpDir, ".archie", "skills"));
    expect(dirExists).toBe(true);
  });

  it("is idempotent", () => {
    ensureSkillsDir(tmpDir);
    ensureSkillsDir(tmpDir);
    const dirExists = fs.existsSync(path.join(tmpDir, ".archie", "skills"));
    expect(dirExists).toBe(true);
  });
});
