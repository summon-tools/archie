import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createTempGitRepo, type TempGitRepo } from "../helpers/temp-git";

// Import the module under test — worktrees.ts uses child_process (not SQLite)
// so it works without the vi.doMock dance.
import { createWorktree, removeWorktree } from "@/lib/server/worktrees";

let repos: TempGitRepo[] = [];

function makeRepo() {
  const repo = createTempGitRepo();
  repos.push(repo);
  return repo;
}

afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
  // Also clean up any worktree dirs created beside the repo
});

describe("createWorktree", () => {
  it("creates a worktree directory and branch", () => {
    const repo = makeRepo();
    const result = createWorktree(repo.dir, 1, "Add login page");
    expect(result.success).toBe(true);
    expect(result.branch_name).toMatch(/^task\/1-add-login-page$/);
    expect(result.worktree_dir).toBeTruthy();
    expect(fs.existsSync(result.worktree_dir)).toBe(true);
    // Clean up worktree
    removeWorktree(repo.dir, result.worktree_dir, result.branch_name);
  });

  it("fails if directory is not a git repo", () => {
    const tmpDir = fs.mkdtempSync("/tmp/archie-no-git-");
    try {
      const result = createWorktree(tmpDir, 1, "Test");
      expect(result.success).toBe(false);
      expect(result.message).toContain("not a git repository");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails if worktree directory already exists", () => {
    const repo = makeRepo();
    const result1 = createWorktree(repo.dir, 1, "First");
    expect(result1.success).toBe(true);
    // Creating again with same taskId should fail because dir exists
    const result2 = createWorktree(repo.dir, 1, "Second");
    expect(result2.success).toBe(false);
    expect(result2.message).toContain("already exists");
    // Clean up
    removeWorktree(repo.dir, result1.worktree_dir, result1.branch_name);
  });

  it("prunes stale git worktree metadata before reusing a task directory", () => {
    const repo = makeRepo();
    const stale = createWorktree(repo.dir, 4, "Old task");
    expect(stale.success).toBe(true);

    fs.rmSync(stale.worktree_dir, { recursive: true, force: true });
    const staleList = execSync("git worktree list --porcelain", { cwd: repo.dir, encoding: "utf-8" });
    expect(staleList).toContain(stale.worktree_dir);

    const fresh = createWorktree(repo.dir, 4, "New task");
    expect(fresh.success).toBe(true);
    expect(fresh.worktree_dir).toBe(stale.worktree_dir);
    expect(fresh.branch_name).toBe("task/4-new-task");
    expect(fs.existsSync(fresh.worktree_dir)).toBe(true);

    removeWorktree(repo.dir, fresh.worktree_dir, fresh.branch_name);
  });

  it("slugifies branch name correctly", () => {
    const repo = makeRepo();
    const result = createWorktree(repo.dir, 42, "Fix the BIG Bug!!!");
    expect(result.branch_name).toBe("task/42-fix-the-big-bug");
    expect(result.success).toBe(true);
    removeWorktree(repo.dir, result.worktree_dir, result.branch_name);
  });
});

describe("removeWorktree", () => {
  it("removes worktree directory and branch", () => {
    const repo = makeRepo();
    const created = createWorktree(repo.dir, 1, "Test task");
    expect(created.success).toBe(true);

    const result = removeWorktree(repo.dir, created.worktree_dir, created.branch_name);
    expect(result.success).toBe(true);
    expect(fs.existsSync(created.worktree_dir)).toBe(false);
  });

  it("succeeds even if worktree dir is already gone", () => {
    const repo = makeRepo();
    const created = createWorktree(repo.dir, 1, "Gone");
    expect(created.success).toBe(true);
    // Manually remove the dir
    fs.rmSync(created.worktree_dir, { recursive: true, force: true });
    const result = removeWorktree(repo.dir, created.worktree_dir, created.branch_name);
    expect(result.success).toBe(true);
  });
});
