import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { githubTokenGitArgs, pull } from "@/lib/server/git";

describe("githubTokenGitArgs", () => {
  it("adds OAuth auth and temporary SSH-to-HTTPS rewrites without changing remote config", () => {
    const args = githubTokenGitArgs("secret-token", ["push", "-u", "origin", "task/test"]);
    const expectedBasic = Buffer.from("x-access-token:secret-token").toString("base64");

    expect(args).toContain(`http.https://github.com/.extraheader=AUTHORIZATION: basic ${expectedBasic}`);
    expect(args).toContain("url.https://github.com/.insteadOf=git@github.com:");
    expect(args).toContain("url.https://github.com/.insteadOf=ssh://git@github.com/");
    expect(args.slice(-4)).toEqual(["push", "-u", "origin", "task/test"]);
  });
});

describe("pull", () => {
  it("does not switch/reset/delete a worktree branch when remote branch fallback is disabled", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archie-pull-test-"));
    const repo = path.join(root, "repo");
    const remote = path.join(root, "remote.git");

    try {
      fs.mkdirSync(repo);
      execSync("git init -b main", { cwd: repo, stdio: "ignore" });
      execSync('git config user.email "test@example.com"', { cwd: repo, stdio: "ignore" });
      execSync('git config user.name "Test User"', { cwd: repo, stdio: "ignore" });
      fs.writeFileSync(path.join(repo, "README.md"), "# Test\n");
      execSync("git add README.md", { cwd: repo, stdio: "ignore" });
      execSync('git commit -m "initial"', { cwd: repo, stdio: "ignore" });
      execSync(`git init --bare ${remote}`, { stdio: "ignore" });
      execSync(`git remote add origin ${remote}`, { cwd: repo, stdio: "ignore" });
      execSync("git push -u origin main", { cwd: repo, stdio: "ignore" });
      execSync("git checkout -b task/local-only", { cwd: repo, stdio: "ignore" });

      const result = pull(repo, {
        branch: "task/local-only",
        fastForwardOnly: true,
        requireClean: true,
        allowDefaultBranchHardReset: false,
        allowDeletedBranchFallback: false,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Remote branch "task/local-only" was not found');
      expect(execSync("git branch --show-current", { cwd: repo, encoding: "utf-8" }).trim()).toBe("task/local-only");
      expect(execSync("git branch --list task/local-only", { cwd: repo, encoding: "utf-8" }).trim()).toContain("task/local-only");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
