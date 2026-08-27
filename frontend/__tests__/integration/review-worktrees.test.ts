import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createReviewWorktree,
  removeReviewWorktree,
  reviewWorktreeRoot,
  sweepOrphanedReviewWorktrees,
  type ReviewWorktree,
} from "@/lib/server/review-worktrees";

let testRoot: string;
let repoDirectory: string;
let headSha: string;
const worktrees: ReviewWorktree[] = [];

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoDirectory,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archie-review-worktree-test-"));
  repoDirectory = path.join(testRoot, "sample-app");
  fs.mkdirSync(repoDirectory);
  git(["init", "-b", "main"]);
  fs.writeFileSync(path.join(repoDirectory, "README.md"), "# Sample\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "initial"]);
  headSha = git(["rev-parse", "HEAD"]);
});

afterEach(() => {
  for (const worktree of worktrees.splice(0)) {
    removeReviewWorktree(worktree, repoDirectory);
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("review worktrees", () => {
  it("creates reviews in a project-adjacent container and removes only the checkout", () => {
    const created = createReviewWorktree({ appDirectory: repoDirectory, reviewId: 17, headSha });
    expect(created.success).toBe(true);
    expect(created.worktree).toBeDefined();
    worktrees.push(created.worktree!);

    const root = reviewWorktreeRoot(repoDirectory);
    expect(root).toBe(path.join(testRoot, "sample-app-review-worktrees"));
    expect(created.worktree!.worktree_dir).toBe(path.join(root, "review-17"));
    expect(fs.existsSync(path.join(root, ".archie-review-worktrees"))).toBe(true);
    expect(fs.existsSync(created.worktree!.worktree_dir)).toBe(true);

    const removed = removeReviewWorktree(created.worktree!, repoDirectory);
    worktrees.length = 0;
    expect(removed.success).toBe(true);
    expect(fs.existsSync(created.worktree!.worktree_dir)).toBe(false);
    expect(fs.existsSync(root)).toBe(true);
  });

  it("sweeps finished or abandoned reviews while preserving active review IDs", () => {
    const abandoned = createReviewWorktree({ appDirectory: repoDirectory, reviewId: 21, headSha });
    const active = createReviewWorktree({ appDirectory: repoDirectory, reviewId: 22, headSha });
    expect(abandoned.worktree).toBeDefined();
    expect(active.worktree).toBeDefined();
    worktrees.push(active.worktree!);

    const sweep = sweepOrphanedReviewWorktrees({
      appDirectory: repoDirectory,
      activeReviewIds: [22],
    });

    expect(sweep).toEqual({ removed: 1, kept: 1, warnings: [] });
    expect(fs.existsSync(abandoned.worktree!.worktree_dir)).toBe(false);
    expect(fs.existsSync(active.worktree!.worktree_dir)).toBe(true);
  });

  it("replaces a stale checkout when a crashed review job is recovered", () => {
    const stale = createReviewWorktree({ appDirectory: repoDirectory, reviewId: 31, headSha });
    expect(stale.worktree).toBeDefined();
    fs.writeFileSync(path.join(stale.worktree!.worktree_dir, "stale.tmp"), "stale");

    const recovered = createReviewWorktree({ appDirectory: repoDirectory, reviewId: 31, headSha });
    expect(recovered.success).toBe(true);
    expect(recovered.worktree).toBeDefined();
    worktrees.push(recovered.worktree!);
    expect(fs.existsSync(path.join(recovered.worktree!.worktree_dir, "stale.tmp"))).toBe(false);
    expect(git(["-C", recovered.worktree!.worktree_dir, "rev-parse", "HEAD"])).toBe(headSha);
  });

  it("refuses to claim a non-empty unowned container", () => {
    const root = reviewWorktreeRoot(repoDirectory);
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "user-file.txt"), "keep me");

    const created = createReviewWorktree({ appDirectory: repoDirectory, reviewId: 40, headSha });

    expect(created.success).toBe(false);
    expect(created.message).toContain("unowned");
    expect(fs.readFileSync(path.join(root, "user-file.txt"), "utf-8")).toBe("keep me");
  });
});
