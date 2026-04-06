/**
 * Temp git repo helper for worktree tests.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

export interface TempGitRepo {
  dir: string;
  cleanup: () => void;
}

/** Create a temp directory with an initialised git repo and an initial commit. */
export function createTempGitRepo(prefix = "archie-git-test-"): TempGitRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });

  // Create initial commit
  const readmePath = path.join(dir, "README.md");
  fs.writeFileSync(readmePath, "# Test Repo\n");
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: "ignore" });

  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}

/** Add a file and commit in the temp repo. */
export function addCommit(dir: string, filename: string, content: string, message: string): void {
  fs.writeFileSync(path.join(dir, filename), content);
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: "ignore" });
}
