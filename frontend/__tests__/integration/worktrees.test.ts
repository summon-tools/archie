import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createTempGitRepo, type TempGitRepo } from "../helpers/temp-git";

// Import the module under test — worktrees.ts uses child_process (not SQLite)
// so it works without the vi.doMock dance.
import { createWorktree, createWorktreeFromBranch, listRemoteBranches, listRemoteBranchesForApp, removeWorktree } from "@/lib/server/worktrees";

let repos: TempGitRepo[] = [];

function makeRepo() {
  const repo = createTempGitRepo();
  repos.push(repo);
  return repo;
}

afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
  vi.restoreAllMocks();
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

describe("createWorktreeFromBranch", () => {
  it("lists available remote branches", () => {
    const repo = makeRepo();
    const remoteDir = fs.mkdtempSync(path.join(path.dirname(repo.dir), "archie-remote-"));
    const baseBranch = execSync("git branch --show-current", { cwd: repo.dir, encoding: "utf-8" }).trim();
    repos.push({
      dir: remoteDir,
      cleanup: () => fs.rmSync(remoteDir, { recursive: true, force: true }),
    });

    execSync("git init --bare", { cwd: remoteDir, stdio: "ignore" });
    execSync(`git remote add origin "${remoteDir}"`, { cwd: repo.dir, stdio: "ignore" });
    execSync("git push origin HEAD:main", { cwd: repo.dir, stdio: "ignore" });
    execSync("git checkout -b feature/existing", { cwd: repo.dir, stdio: "ignore" });
    fs.writeFileSync(path.join(repo.dir, "feature.txt"), "remote branch\n");
    execSync("git add feature.txt", { cwd: repo.dir, stdio: "ignore" });
    execSync('git commit -m "add feature branch"', { cwd: repo.dir, stdio: "ignore" });
    execSync("git push origin feature/existing", { cwd: repo.dir, stdio: "ignore" });
    execSync(`git checkout ${baseBranch}`, { cwd: repo.dir, stdio: "ignore" });

    const result = listRemoteBranches(repo.dir);

    expect(result.success).toBe(true);
    expect(result.branches).toEqual(["feature/existing", "main"]);
  });

  it("can exclude branches already checked out in a worktree", () => {
    const repo = makeRepo();
    const remoteDir = fs.mkdtempSync(path.join(path.dirname(repo.dir), "archie-remote-"));
    const baseBranch = execSync("git branch --show-current", { cwd: repo.dir, encoding: "utf-8" }).trim();
    repos.push({
      dir: remoteDir,
      cleanup: () => fs.rmSync(remoteDir, { recursive: true, force: true }),
    });

    execSync("git init --bare", { cwd: remoteDir, stdio: "ignore" });
    execSync(`git remote add origin "${remoteDir}"`, { cwd: repo.dir, stdio: "ignore" });
    execSync("git push origin HEAD:main", { cwd: repo.dir, stdio: "ignore" });
    execSync("git checkout -b feature/existing", { cwd: repo.dir, stdio: "ignore" });
    fs.writeFileSync(path.join(repo.dir, "feature.txt"), "remote branch\n");
    execSync("git add feature.txt", { cwd: repo.dir, stdio: "ignore" });
    execSync('git commit -m "add feature branch"', { cwd: repo.dir, stdio: "ignore" });
    execSync("git push origin feature/existing", { cwd: repo.dir, stdio: "ignore" });
    execSync(`git checkout ${baseBranch}`, { cwd: repo.dir, stdio: "ignore" });

    const result = listRemoteBranches(repo.dir, { excludeCheckedOut: true });

    expect(result.success).toBe(true);
    expect(result.branches).toEqual(["feature/existing"]);
  });

  it("lists GitHub remote branches through the API when a token is available", async () => {
    const repo = makeRepo();
    execSync("git remote add origin git@github.com:owner/repo.git", { cwd: repo.dir, stdio: "ignore" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { name: "main" },
        { name: "feature/api-branch" },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listRemoteBranchesForApp(repo.dir, { token: "user-token" });

    expect(result.success).toBe(true);
    expect(result.branches).toEqual(["feature/api-branch", "main"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/branches?per_page=100&page=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer user-token",
        }),
      }),
    );
  });

  it("creates a worktree from an existing remote branch without deleting the branch on cleanup", () => {
    const repo = makeRepo();
    const remoteDir = fs.mkdtempSync(path.join(path.dirname(repo.dir), "archie-remote-"));
    const baseBranch = execSync("git branch --show-current", { cwd: repo.dir, encoding: "utf-8" }).trim();
    repos.push({
      dir: remoteDir,
      cleanup: () => fs.rmSync(remoteDir, { recursive: true, force: true }),
    });

    execSync("git init --bare", { cwd: remoteDir, stdio: "ignore" });
    execSync(`git remote add origin "${remoteDir}"`, { cwd: repo.dir, stdio: "ignore" });
    execSync("git checkout -b feature/existing", { cwd: repo.dir, stdio: "ignore" });
    fs.writeFileSync(path.join(repo.dir, "feature.txt"), "remote branch\n");
    execSync("git add feature.txt", { cwd: repo.dir, stdio: "ignore" });
    execSync('git commit -m "add feature branch"', { cwd: repo.dir, stdio: "ignore" });
    execSync("git push origin feature/existing", { cwd: repo.dir, stdio: "ignore" });
    execSync(`git checkout ${baseBranch}`, { cwd: repo.dir, stdio: "ignore" });
    execSync("git branch -D feature/existing", { cwd: repo.dir, stdio: "ignore" });

    const result = createWorktreeFromBranch(repo.dir, 7, "feature/existing");

    expect(result.success).toBe(true);
    expect(result.branch_name).toBe("feature/existing");
    expect(fs.existsSync(path.join(result.worktree_dir, "feature.txt"))).toBe(true);

    removeWorktree(repo.dir, result.worktree_dir, "");

    const branchCheck = execSync("git rev-parse --verify refs/heads/feature/existing", {
      cwd: repo.dir,
      encoding: "utf-8",
    }).trim();
    expect(branchCheck).toBeTruthy();
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
