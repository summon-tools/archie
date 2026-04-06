import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { readSpecIndex, readPrinciples } from "@/lib/server/spec";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archie-spec-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeSpecFile(content: string) {
  const specDir = path.join(tmpDir, ".archie", "spec");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, "_index.md"), content);
}

function writePrinciples(content: string) {
  const specDir = path.join(tmpDir, ".archie", "spec");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, "PRINCIPLES.md"), content);
}

describe("readSpecIndex", () => {
  it("parses a well-formed _index.md", () => {
    writeSpecFile(`# My App

- features.md: Core feature descriptions
- architecture.md: System architecture overview
`);

    const result = readSpecIndex(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.appName).toBe("My App");
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries[0]).toEqual({ path: "features.md", summary: "Core feature descriptions" });
    expect(result!.entries[1]).toEqual({ path: "architecture.md", summary: "System architecture overview" });
  });

  it("returns null when _index.md is missing", () => {
    expect(readSpecIndex(tmpDir)).toBeNull();
  });

  it("handles empty file gracefully", () => {
    writeSpecFile("");
    const result = readSpecIndex(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.appName).toBe("");
    expect(result!.entries).toHaveLength(0);
  });

  it("handles nested paths", () => {
    writeSpecFile(`# App

- api/routes.md: API route definitions
- models/user.md: User model spec
`);

    const result = readSpecIndex(tmpDir);
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries[0].path).toBe("api/routes.md");
  });
});

describe("readPrinciples", () => {
  it("reads PRINCIPLES.md content", () => {
    writePrinciples("# Principles\n\n- Always test your code");
    const result = readPrinciples(tmpDir);
    expect(result).toContain("Always test your code");
  });

  it("returns null when missing", () => {
    expect(readPrinciples(tmpDir)).toBeNull();
  });
});
