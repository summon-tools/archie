import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createTempGitRepo, type TempGitRepo } from "../helpers/temp-git";

// Import the module under test — worktrees.ts uses child_process (not SQLite)
// so it works without the vi.doMock dance.
import { createWorktree, createWorktreeFromBranch, listRemoteBranches, removeWorktree } from "@/lib/server/worktrees";

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

  it("copies untracked FastAPI SQLite databases into the worktree", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo.dir, "requirements.txt"), "fastapi\nuvicorn\naiosqlite\n");
    fs.writeFileSync(path.join(repo.dir, "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n");
    execSync("git add requirements.txt main.py", { cwd: repo.dir, stdio: "ignore" });
    execSync('git commit -m "add fastapi app"', { cwd: repo.dir, stdio: "ignore" });

    fs.writeFileSync(path.join(repo.dir, ".env"), "DATABASE_URL=sqlite:///./app.sqlite3\n");
    fs.writeFileSync(path.join(repo.dir, "app.sqlite3"), "sqlite data");
    fs.writeFileSync(path.join(repo.dir, "app.sqlite3-wal"), "sqlite wal");

    const result = createWorktree(repo.dir, 5, "FastAPI sqlite task");

    expect(result.success).toBe(true);
    expect(result.techStack?.framework).toBe("fastapi");
    expect(result.techStack?.database).toBe("sqlite");
    expect(fs.existsSync(path.join(result.worktree_dir, ".env"))).toBe(true);
    expect(fs.readFileSync(path.join(result.worktree_dir, "app.sqlite3"), "utf-8")).toBe("sqlite data");
    expect(fs.readFileSync(path.join(result.worktree_dir, "app.sqlite3-wal"), "utf-8")).toBe("sqlite wal");

    removeWorktree(repo.dir, result.worktree_dir, result.branch_name);
  });

  it("patches untracked FastAPI PostgreSQL env URLs for the worktree database", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo.dir, "requirements.txt"), "fastapi\nuvicorn\nasyncpg\n");
    fs.writeFileSync(path.join(repo.dir, "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n");
    execSync("git add requirements.txt main.py", { cwd: repo.dir, stdio: "ignore" });
    execSync('git commit -m "add fastapi postgres app"', { cwd: repo.dir, stdio: "ignore" });
    fs.writeFileSync(path.join(repo.dir, ".env"), "DATABASE_URL=postgresql+asyncpg://archie:secret@localhost:5432/archie_dev\n");

    const fakeBin = fs.mkdtempSync(path.join(path.dirname(repo.dir), "archie-fake-pg-"));
    repos.push({
      dir: fakeBin,
      cleanup: () => fs.rmSync(fakeBin, { recursive: true, force: true }),
    });
    fs.writeFileSync(path.join(fakeBin, "psql"), "#!/bin/sh\nif [ \"$1\" = \"-lqt\" ]; then exit 1; fi\ncat >/dev/null\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(path.join(fakeBin, "createdb"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(path.join(fakeBin, "pg_dump"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath || ""}`;
    let result: ReturnType<typeof createWorktree> | null = null;
    try {
      result = createWorktree(repo.dir, 6, "FastAPI postgres task");

      expect(result.success).toBe(true);
      expect(result.techStack?.framework).toBe("fastapi");
      expect(result.techStack?.database).toBe("postgresql");
      expect(result.techStack?.databaseName).toBe("archie_dev");
      expect(fs.readFileSync(path.join(result.worktree_dir, ".env"), "utf-8")).toContain("archie_dev_task_6");
    } finally {
      if (result?.worktree_dir && result.branch_name) {
        removeWorktree(repo.dir, result.worktree_dir, result.branch_name);
      }
      process.env.PATH = previousPath;
    }
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
