import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const REVIEW_ROOT_SUFFIX = "-review-worktrees";
const REVIEW_ROOT_MARKER = ".archie-review-worktrees";
const REVIEW_DIR_PATTERN = /^review-(\d+)$/;

interface GitResult {
  stdout: string;
  returncode: number;
}

function gitArgsWithGitHubToken(args: string[], token?: string | null): string[] {
  if (!token) return args;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return [
    "-c",
    `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`,
    "-c",
    "url.https://github.com/.insteadOf=git@github.com:",
    "-c",
    "url.https://github.com/.insteadOf=ssh://git@github.com/",
    ...args,
  ];
}

function runGit(directory: string, args: string[], timeout = 30000, token?: string | null): GitResult {
  const env = {
    ...process.env,
    HOME: os.homedir(),
    GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes",
  };
  try {
    return {
      stdout: execFileSync("git", gitArgsWithGitHubToken(args, token), {
        cwd: directory,
        timeout,
        env,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }),
      returncode: 0,
    };
  } catch (error: any) {
    return {
      stdout: `${error.stdout?.toString() || ""}${error.stderr?.toString() || ""}`,
      returncode: error.status ?? 1,
    };
  }
}

export function reviewWorktreeRoot(appDirectory: string): string {
  const resolvedAppDirectory = path.resolve(appDirectory);
  return path.join(
    path.dirname(resolvedAppDirectory),
    `${path.basename(resolvedAppDirectory)}${REVIEW_ROOT_SUFFIX}`,
  );
}

function markerPath(rootDir: string): string {
  return path.join(rootDir, REVIEW_ROOT_MARKER);
}

function markerContents(appDirectory: string): string {
  return `${JSON.stringify({
    owner: "archie",
    purpose: "pull_request_review_worktrees",
    app_directory: path.resolve(appDirectory),
    version: 1,
  }, null, 2)}\n`;
}

function isOwnedReviewRoot(rootDir: string, appDirectory: string): boolean {
  const expectedRoot = reviewWorktreeRoot(appDirectory);
  if (path.resolve(rootDir) !== path.resolve(expectedRoot) || !fs.existsSync(rootDir)) return false;
  try {
    if (!fs.lstatSync(rootDir).isDirectory() || fs.lstatSync(rootDir).isSymbolicLink()) return false;
    const marker = JSON.parse(fs.readFileSync(markerPath(rootDir), "utf-8"));
    return marker?.owner === "archie"
      && marker?.purpose === "pull_request_review_worktrees"
      && marker?.app_directory === path.resolve(appDirectory);
  } catch {
    return false;
  }
}

function ensureReviewRoot(appDirectory: string): ReviewWorktreeResult & { root_dir?: string } {
  const rootDir = reviewWorktreeRoot(appDirectory);
  try {
    if (fs.existsSync(rootDir)) {
      const stat = fs.lstatSync(rootDir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return { success: false, message: "The review worktree container is not a safe directory." };
      }
      if (!fs.existsSync(markerPath(rootDir))) {
        const entries = fs.readdirSync(rootDir);
        if (entries.length > 0) {
          return { success: false, message: "Refusing to use an unowned, non-empty review worktree container." };
        }
      }
    } else {
      fs.mkdirSync(rootDir, { recursive: true });
    }

    if (!fs.existsSync(markerPath(rootDir))) {
      try {
        fs.writeFileSync(markerPath(rootDir), markerContents(appDirectory), { encoding: "utf-8", flag: "wx", mode: 0o600 });
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    if (!isOwnedReviewRoot(rootDir, appDirectory)) {
      return { success: false, message: "The review worktree container ownership marker is invalid." };
    }
    return { success: true, message: "Review worktree container is ready.", root_dir: rootDir };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Unable to prepare the review worktree container." };
  }
}

function isReviewWorktreePath(worktreeDir: string, rootDir: string): boolean {
  return path.dirname(path.resolve(worktreeDir)) === path.resolve(rootDir)
    && REVIEW_DIR_PATTERN.test(path.basename(worktreeDir));
}

function removeWorktreePath(appDirectory: string, worktreeDir: string): GitResult {
  const remove = runGit(appDirectory, ["worktree", "remove", worktreeDir, "--force"], 30000);
  try {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  } catch (error) {
    return {
      returncode: 1,
      stdout: error instanceof Error ? error.message : "Unable to remove the review worktree directory.",
    };
  }
  return remove;
}

export interface ReviewWorktree {
  root_dir: string;
  worktree_dir: string;
  head_sha: string;
}

export interface ReviewWorktreeResult {
  success: boolean;
  message: string;
  worktree?: ReviewWorktree;
}

export interface ReviewWorktreeSweepResult {
  removed: number;
  kept: number;
  warnings: string[];
}

export function createReviewWorktree(input: {
  appDirectory: string;
  reviewId: number;
  headSha: string;
  token?: string | null;
}): ReviewWorktreeResult {
  if (!/^[0-9a-f]{7,64}$/i.test(input.headSha)) {
    return { success: false, message: "The review head SHA is invalid." };
  }
  if (!fs.existsSync(path.join(input.appDirectory, ".git"))) {
    return { success: false, message: "The mapped project directory is not a Git repository." };
  }

  const root = ensureReviewRoot(input.appDirectory);
  if (!root.success || !root.root_dir) return { success: false, message: root.message };
  const rootDir = root.root_dir;
  const worktreeDir = path.join(rootDir, `review-${input.reviewId}`);
  runGit(input.appDirectory, ["worktree", "prune"], 15000);

  try {
    // A recovered job reuses the same deterministic path. Remove only that
    // review's stale checkout before recreating it at the requested head.
    if (fs.existsSync(worktreeDir)) {
      removeWorktreePath(input.appDirectory, worktreeDir);
      runGit(input.appDirectory, ["worktree", "prune"], 15000);
    }

    let commit = runGit(input.appDirectory, ["rev-parse", "--verify", `${input.headSha}^{commit}`], 10000);
    if (commit.returncode !== 0) {
      const fetch = runGit(input.appDirectory, ["fetch", "--no-tags", "origin", input.headSha], 120000, input.token);
      if (fetch.returncode !== 0) {
        return { success: false, message: `Unable to fetch the review commit: ${fetch.stdout.trim().slice(0, 500)}` };
      }
      commit = runGit(input.appDirectory, ["rev-parse", "--verify", `${input.headSha}^{commit}`], 10000);
    }
    if (commit.returncode !== 0) {
      return { success: false, message: "The review commit is not available in the local repository." };
    }

    const add = runGit(input.appDirectory, ["worktree", "add", "--detach", worktreeDir, input.headSha], 30000, input.token);
    if (add.returncode !== 0) {
      removeWorktreePath(input.appDirectory, worktreeDir);
      runGit(input.appDirectory, ["worktree", "prune"], 15000);
      return { success: false, message: `Unable to create the isolated review worktree: ${add.stdout.trim().slice(0, 500)}` };
    }

    return {
      success: true,
      message: "Isolated review worktree created.",
      worktree: { root_dir: rootDir, worktree_dir: worktreeDir, head_sha: input.headSha },
    };
  } catch (error) {
    removeWorktreePath(input.appDirectory, worktreeDir);
    runGit(input.appDirectory, ["worktree", "prune"], 15000);
    return { success: false, message: error instanceof Error ? error.message : "Unable to create the isolated review worktree." };
  }
}

export function removeReviewWorktree(input: ReviewWorktree, appDirectory: string): ReviewWorktreeResult {
  if (!isOwnedReviewRoot(input.root_dir, appDirectory) || !isReviewWorktreePath(input.worktree_dir, input.root_dir)) {
    return { success: false, message: "Refusing to clean an unrecognized review worktree path." };
  }

  const remove = removeWorktreePath(appDirectory, input.worktree_dir);
  runGit(appDirectory, ["worktree", "prune"], 15000);

  return {
    success: remove.returncode === 0,
    message: remove.returncode === 0
      ? "Review worktree removed."
      : `Review worktree removed with Git warnings: ${remove.stdout.trim().slice(0, 300)}`,
  };
}

export function sweepOrphanedReviewWorktrees(input: {
  appDirectory: string;
  activeReviewIds?: Iterable<number>;
}): ReviewWorktreeSweepResult {
  const rootDir = reviewWorktreeRoot(input.appDirectory);
  if (!fs.existsSync(rootDir)) return { removed: 0, kept: 0, warnings: [] };
  if (!isOwnedReviewRoot(rootDir, input.appDirectory)) {
    return { removed: 0, kept: 0, warnings: ["Refusing to sweep an unowned review worktree container."] };
  }

  const activeReviewIds = new Set(input.activeReviewIds || []);
  const result: ReviewWorktreeSweepResult = { removed: 0, kept: 0, warnings: [] };
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const match = entry.name.match(REVIEW_DIR_PATTERN);
    if (!match) continue;
    const reviewId = Number(match[1]);
    if (activeReviewIds.has(reviewId)) {
      result.kept += 1;
      continue;
    }

    const worktreeDir = path.join(rootDir, entry.name);
    const remove = removeWorktreePath(input.appDirectory, worktreeDir);
    if (remove.returncode === 0 || !fs.existsSync(worktreeDir)) {
      result.removed += 1;
    } else {
      result.warnings.push(`Unable to remove ${entry.name}: ${remove.stdout.trim().slice(0, 300)}`);
    }
  }
  runGit(input.appDirectory, ["worktree", "prune"], 15000);
  return result;
}
