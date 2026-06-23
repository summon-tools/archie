import { execSync, execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// .gitignore templates by project type
const GITIGNORE_TEMPLATES: Record<string, string> = {
  fullstack: `# Dependencies
node_modules/

# Next.js build
.next/

# Python
__pycache__/
*.pyc
*.pyo
venv/
.venv/

# Database
dashboard.db
*.db-journal

# Archie runtime (not tracked)
.archie/logs/
.archie/pids/
.archie/videos/
.archie/context-files/

# Claude
claude_logs/

# Environment
.env
.env.local
.env*.local

# OS
.DS_Store
`,
  nextjs: `# Dependencies
node_modules/

# Next.js build
.next/
out/

# Archie runtime (not tracked)
.archie/logs/
.archie/pids/
.archie/videos/
.archie/context-files/

# Environment
.env
.env.local
.env*.local

# OS
.DS_Store

# Misc
*.pem
npm-debug.log*
`,
  vite: `# Dependencies
node_modules/

# Build output
dist/
dist-ssr/

# Archie runtime (not tracked)
.archie/logs/
.archie/pids/
.archie/videos/
.archie/context-files/

# Environment
.env
.env.local
*.local

# OS
.DS_Store
`,
};

const CRITICAL_IGNORES = [".archie/logs/", ".archie/pids/", ".archie/videos/", ".archie/context-files/"];
const LEGACY_IGNORES = [".archie/seed.sh", ".logs/", ".pids/", "start.sh", "stop.sh", ".preview-start.sh", ".preview-stop.sh"];

function runGit(directory: string, args: string[], timeout = 30000): string {
  const env = { ...process.env, HOME: os.homedir(), GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes" };
  try {
    return execFileSync("git", args, {
      cwd: directory,
      timeout,
      env,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e: any) {
    // Return stderr as the error, but allow callers to check
    throw e;
  }
}

function runGitSafe(directory: string, args: string[], timeout = 30000): { stdout: string; returncode: number } {
  const env = { ...process.env, HOME: os.homedir(), GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes" };
  try {
    const stdout = execFileSync("git", args, {
      cwd: directory,
      timeout,
      env,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, returncode: 0 };
  } catch (e: any) {
    const stdout = e.stdout?.toString() || "";
    const stderr = e.stderr?.toString() || "";
    return { stdout: stdout || stderr, returncode: e.status ?? 1 };
  }
}

function runCmd(args: string[], timeout = 30000, cwd?: string): { stdout: string; stderr: string; returncode: number } {
  try {
    const stdout = execFileSync(args[0], args.slice(1), {
      timeout,
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", returncode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() || "",
      stderr: e.stderr?.toString() || "",
      returncode: e.status ?? 1,
    };
  }
}

// --- SSH Key Management ---

export function setupSshKey(): { success: boolean; message: string; public_key: string } {
  const sshDir = path.join(os.homedir(), ".ssh");
  const keyPath = path.join(sshDir, "id_ed25519");
  const pubPath = keyPath + ".pub";

  fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });

  if (fs.existsSync(keyPath)) {
    const pubKey = fs.readFileSync(pubPath, "utf-8").trim();
    return { success: true, message: "SSH key already exists", public_key: pubKey };
  }

  try {
    const result = runCmd([
      "ssh-keygen", "-t", "ed25519",
      "-C", "archie@dashboard-server",
      "-f", keyPath,
      "-N", "",
    ]);
    if (result.returncode !== 0) {
      return { success: false, message: `Key generation failed: ${result.stderr}`, public_key: "" };
    }

    // Add github.com to known_hosts
    const knownHosts = path.join(sshDir, "known_hosts");
    const scan = runCmd(["ssh-keyscan", "github.com"]);
    if (scan.returncode === 0 && scan.stdout.trim()) {
      let existing = "";
      if (fs.existsSync(knownHosts)) {
        existing = fs.readFileSync(knownHosts, "utf-8");
      }
      if (!existing.includes("github.com")) {
        fs.appendFileSync(knownHosts, scan.stdout);
      }
    }

    const pubKey = fs.readFileSync(pubPath, "utf-8").trim();
    return { success: true, message: "SSH key generated successfully", public_key: pubKey };
  } catch (e: any) {
    return { success: false, message: String(e), public_key: "" };
  }
}

export function getSshPublicKey(): string | null {
  const pubPath = path.join(os.homedir(), ".ssh", "id_ed25519.pub");
  if (fs.existsSync(pubPath)) {
    return fs.readFileSync(pubPath, "utf-8").trim();
  }
  return null;
}

export function getSshKeyPath(): string | null {
  const pubPath = path.join(os.homedir(), ".ssh", "id_ed25519.pub");
  if (fs.existsSync(pubPath)) return pubPath;
  return null;
}

// --- Git Config ---

export function getGitConfig(): { name: string; email: string } {
  let name = "";
  let email = "";
  try {
    const r1 = runCmd(["git", "config", "--global", "user.name"]);
    if (r1.returncode === 0) name = r1.stdout.trim();
    const r2 = runCmd(["git", "config", "--global", "user.email"]);
    if (r2.returncode === 0) email = r2.stdout.trim();
  } catch {
    // ignore
  }
  return { name, email };
}

export function setGitConfig(name: string, email: string): { success: boolean; message: string } {
  try {
    if (name) {
      const r = runCmd(["git", "config", "--global", "user.name", name]);
      if (r.returncode !== 0) return { success: false, message: `Failed to set name: ${r.stderr}` };
    }
    if (email) {
      const r = runCmd(["git", "config", "--global", "user.email", email]);
      if (r.returncode !== 0) return { success: false, message: `Failed to set email: ${r.stderr}` };
    }
    return { success: true, message: "Git config updated" };
  } catch (e: any) {
    return { success: false, message: String(e) };
  }
}

// --- Clone Operations ---

export function extractRepoName(url: string): string {
  url = url.trim().replace(/\/+$/, "");
  if (url.endsWith(".git")) url = url.slice(0, -4);
  if (url.includes(":") && url.includes("@")) {
    return url.split("/").pop()?.split(":").pop() || "";
  }
  return url.split("/").pop() || "";
}

/**
 * Normalizes a GitHub URL to HTTPS format for gh-first workflow.
 * Converts SSH URLs to HTTPS. Keeps HTTPS URLs as-is.
 */
export function normalizeGithubUrl(url: string): string {
  url = url.trim().replace(/\/+$/, "");
  // SSH -> HTTPS
  const sshMatch = url.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}.git`;
  }
  // Already HTTPS - ensure .git suffix
  const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch && !url.endsWith(".git")) {
    return `${url}.git`;
  }
  return url;
}

export function cloneRepo(url: string, targetDir: string): { success: boolean; message: string; ssh_url?: string } {
  const httpsUrl = normalizeGithubUrl(url);
  try {
    const env = { ...process.env, HOME: os.homedir() };
    execFileSync("git", ["clone", httpsUrl, targetDir], {
      timeout: 120000,
      env,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, message: "Repository cloned successfully", ssh_url: httpsUrl };
  } catch (e: any) {
    let errorMsg = e.stderr?.toString().trim() || String(e);
    if (errorMsg.includes("Permission denied")) {
      errorMsg = "Authentication failed. Run `gh auth login` to authenticate with GitHub.";
    } else if (errorMsg.includes("not found")) {
      errorMsg = "Repository not found. Check the URL and ensure the repo exists.";
    } else if (errorMsg.includes("could not read Username")) {
      errorMsg = "Authentication failed. Run `gh auth login` \u2014 make sure your SSH key is added to GitHub.";
    }
    return { success: false, message: `Clone failed: ${errorMsg}` };
  }
}

// --- Git Repository Operations ---

export function isGitInitialized(directory: string): boolean {
  return fs.existsSync(path.join(directory, ".git"));
}

function detectProjectType(directory: string): string {
  if (fs.existsSync(path.join(directory, "backend"))) return "fullstack";
  if (
    fs.existsSync(path.join(directory, "vite.config.js")) ||
    fs.existsSync(path.join(directory, "vite.config.ts"))
  )
    return "vite";
  return "nextjs";
}

export function ensureGitignore(directory: string): void {
  const gitignorePath = path.join(directory, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    const projectType = detectProjectType(directory);
    fs.writeFileSync(gitignorePath, GITIGNORE_TEMPLATES[projectType]);
  } else {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    const missing = CRITICAL_IGNORES.filter((e) => !content.includes(e));
    if (missing.length > 0) {
      const append = "\n# Archie runtime (not tracked)\n" + missing.map((e) => `${e}\n`).join("");
      fs.appendFileSync(gitignorePath, append);
    }
  }
  // Untrack files that are already tracked but should be ignored
  for (const pattern of [...CRITICAL_IGNORES, ...LEGACY_IGNORES]) {
    runGitSafe(directory, ["rm", "-r", "--cached", "--ignore-unmatch", pattern]);
  }
}

export function initRepo(directory: string): { success: boolean; message: string } {
  if (!fs.existsSync(directory)) {
    return { success: false, message: `Directory ${directory} does not exist` };
  }
  try {
    if (!isGitInitialized(directory)) {
      const r = runGitSafe(directory, ["init"]);
      if (r.returncode !== 0) return { success: false, message: `git init failed: ${r.stdout}` };
    }
    ensureGitignore(directory);
    runGitSafe(directory, ["branch", "-M", "main"]);
    runGitSafe(directory, ["add", "-A"]);
    const r = runGitSafe(directory, ["commit", "-m", "Initial commit"]);
    if (r.returncode !== 0 && !r.stdout.includes("nothing to commit")) {
      return { success: false, message: `Initial commit failed: ${r.stdout}` };
    }
    return { success: true, message: "Repository initialized with initial commit" };
  } catch (e: any) {
    return { success: false, message: String(e) };
  }
}

export function setRemote(directory: string, repoUrl: string): { success: boolean; message: string } {
  try {
    const sshUrl = normalizeGithubUrl(repoUrl);
    runGitSafe(directory, ["remote", "remove", "origin"]);
    const r = runGitSafe(directory, ["remote", "add", "origin", sshUrl]);
    if (r.returncode !== 0) return { success: false, message: `Failed to set remote: ${r.stdout}` };
    return { success: true, message: `Remote set to ${sshUrl}` };
  } catch (e: any) {
    return { success: false, message: String(e) };
  }
}

export function getStatus(directory: string): Record<string, any> {
  const result: Record<string, any> = {
    initialized: false,
    has_remote: false,
    remote_url: "",
    has_changes: false,
    uncommitted_count: 0,
    unpushed_count: 0,
    behind_count: 0,
    last_commit_message: "",
    last_commit_date: "",
    branch: "",
  };

  if (!fs.existsSync(directory) || !isGitInitialized(directory)) return result;
  result.initialized = true;

  try {
    const branch = runGitSafe(directory, ["branch", "--show-current"]);
    result.branch = branch.stdout.trim();

    const remote = runGitSafe(directory, ["remote", "get-url", "origin"]);
    if (remote.returncode === 0) {
      result.has_remote = true;
      result.remote_url = remote.stdout.trim();
    }

    const status = runGitSafe(directory, ["status", "--porcelain"]);
    const lines = status.stdout
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    result.has_changes = lines.length > 0;
    result.uncommitted_count = lines.length;

    if (result.has_remote && result.branch) {
      // Fetch latest from remote
      runGitSafe(directory, ["fetch", "origin", result.branch], 15000);

      const unpushed = runGitSafe(directory, ["rev-list", `origin/${result.branch}..HEAD`, "--count"]);
      if (unpushed.returncode === 0 && /^\d+$/.test(unpushed.stdout.trim())) {
        result.unpushed_count = parseInt(unpushed.stdout.trim(), 10);
      } else {
        // origin/branch doesn't exist — compare against base branch instead
        const base = runGitSafe(directory, ["rev-parse", "--verify", "origin/main"]);
        const baseBranch = base.returncode === 0 ? "origin/main" : "origin/master";
        const fromBase = runGitSafe(directory, ["rev-list", `${baseBranch}..HEAD`, "--count"]);
        if (fromBase.returncode === 0 && /^\d+$/.test(fromBase.stdout.trim())) {
          result.unpushed_count = parseInt(fromBase.stdout.trim(), 10);
        }
      }

      const behind = runGitSafe(directory, ["rev-list", `HEAD..origin/${result.branch}`, "--count"]);
      if (behind.returncode === 0 && /^\d+$/.test(behind.stdout.trim())) {
        result.behind_count = parseInt(behind.stdout.trim(), 10);
      }
    }

    const log = runGitSafe(directory, ["log", "-1", "--format=%s|%ci"]);
    if (log.returncode === 0 && log.stdout.trim()) {
      const parts = log.stdout.trim().split("|");
      result.last_commit_message = parts[0];
      result.last_commit_date = parts[1] || "";
    }
  } catch {
    // ignore
  }

  return result;
}

/** Detect the default branch (main or master) for a repo. */
function getDefaultBranch(directory: string): string {
  // Check remote HEAD first
  const remoteHead = runGitSafe(directory, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
  if (remoteHead.returncode === 0) {
    const branch = remoteHead.stdout.trim().replace("origin/", "");
    if (branch) return branch;
  }
  // Fallback: check if main exists, otherwise master
  const mainCheck = runGitSafe(directory, ["rev-parse", "--verify", "main"]);
  return mainCheck.returncode === 0 ? "main" : "master";
}

export function getDefaultBranchName(directory: string): string {
  return getDefaultBranch(directory);
}

export interface GitPullOptions {
  branch?: string;
  token?: string | null;
  fastForwardOnly?: boolean;
  requireClean?: boolean;
  allowDefaultBranchHardReset?: boolean;
  allowDeletedBranchFallback?: boolean;
}

function normalizePullOptions(branchOrOptions?: string | GitPullOptions): GitPullOptions {
  if (typeof branchOrOptions === "string") return { branch: branchOrOptions };
  return branchOrOptions || {};
}

function tokenizedGitArgs(token: string | null | undefined, args: string[]): string[] {
  if (!token) return args;
  return githubTokenGitArgs(token, args);
}

export function isWorktreeClean(directory: string): { clean: boolean; message: string } {
  const status = runGitSafe(directory, ["status", "--porcelain"]);
  if (status.returncode !== 0) {
    return { clean: false, message: status.stdout.trim() || "Unable to inspect worktree status" };
  }
  if (status.stdout.trim()) {
    return {
      clean: false,
      message: "Cannot pull because the worktree has local changes. Commit, push, or stash them before pulling.",
    };
  }
  return { clean: true, message: "Worktree is clean" };
}

export function pull(directory: string, branchOrOptions?: string | GitPullOptions): { success: boolean; message: string } {
  const options = normalizePullOptions(branchOrOptions);
  let branch = options.branch;
  if (!isGitInitialized(directory)) {
    return { success: false, message: "Git not initialized" };
  }
  try {
    const remote = runGitSafe(directory, ["remote", "get-url", "origin"]);
    if (remote.returncode !== 0) {
      return { success: false, message: "No remote configured. Connect to GitHub first." };
    }

    if (!branch) {
      const br = runGitSafe(directory, ["branch", "--show-current"]);
      branch = br.stdout.trim() || "main";
    }

    if (options.requireClean) {
      const clean = isWorktreeClean(directory);
      if (!clean.clean) return { success: false, message: clean.message };
    }

    // On main/master, force-sync to match remote exactly unless callers opt
    // into the safer fast-forward flow used by chat-triggered git operations.
    if (branch === "main" || branch === "master") {
      if (options.allowDefaultBranchHardReset !== false) {
        ensureGitignore(directory);
        const fetchResult = runGitSafe(directory, tokenizedGitArgs(options.token, ["fetch", "origin", branch]), 15000);
        if (fetchResult.returncode !== 0) {
          return { success: false, message: fetchResult.stdout.trim() || `Failed to fetch ${branch} from GitHub` };
        }
        const resetResult = runGitSafe(directory, ["reset", "--hard", `origin/${branch}`]);
        if (resetResult.returncode !== 0) {
          return { success: false, message: resetResult.stdout.trim() || `Failed to reset to origin/${branch}` };
        }
        const cleanResult = runGitSafe(directory, ["clean", "-fd", "--exclude=.archie"]);
        if (cleanResult.returncode !== 0) {
          return { success: false, message: cleanResult.stdout.trim() || "Failed to remove untracked files" };
        }
        return { success: true, message: `Synced to latest ${branch} from GitHub` };
      }
    }

    const pullArgs = [
      "pull",
      ...(options.fastForwardOnly ? ["--ff-only"] : []),
      "origin",
      branch,
    ];
    const pullResult = runGitSafe(directory, tokenizedGitArgs(options.token, pullArgs));
    if (pullResult.returncode !== 0) {
      let errorMsg = pullResult.stdout.trim();

      // If the remote branch was deleted (e.g. merged and cleaned up),
      // switch to main and sync from there
      if (errorMsg.includes("couldn't find remote ref")) {
        if (options.allowDeletedBranchFallback === false) {
          return {
            success: false,
            message: `Remote branch "${branch}" was not found. It may have been merged or deleted on GitHub.`,
          };
        }
        const defaultBranch = getDefaultBranch(directory);
        runGitSafe(directory, ["checkout", defaultBranch]);
        runGitSafe(directory, tokenizedGitArgs(options.token, ["fetch", "origin", defaultBranch]), 15000);
        runGitSafe(directory, ["reset", "--hard", `origin/${defaultBranch}`]);
        runGitSafe(directory, ["clean", "-fd", "--exclude=.archie"]);
        // Clean up the now-orphaned local branch
        runGitSafe(directory, ["branch", "-D", branch]);
        return { success: true, message: `Branch "${branch}" was merged and deleted on remote. Switched to ${defaultBranch} and synced.` };
      }

      if (errorMsg.includes("Permission denied")) {
        errorMsg = "Authentication failed. Run `gh auth login` to authenticate with GitHub.";
      } else if (errorMsg.includes("not found")) {
        errorMsg = "Repository not found. Check your remote URL.";
      } else if (errorMsg.includes("CONFLICT")) {
        errorMsg = "Merge conflicts detected. Resolve them manually.";
      } else if (errorMsg.includes("Not possible to fast-forward")) {
        errorMsg = "Cannot pull because the branch cannot be fast-forwarded. Rebase or merge manually, then retry.";
      }
      return { success: false, message: errorMsg };
    }

    const alreadyUpToDate = pullResult.stdout.includes("Already up to date");
    return {
      success: true,
      message: alreadyUpToDate ? "Already up to date" : "Pulled latest changes",
    };
  } catch (e: any) {
    return { success: false, message: String(e) };
  }
}

export interface GitPushOptions {
  branch?: string;
  author?: { name: string; email: string } | null;
  coAuthor?: { name: string; email: string } | null;
  token?: string | null;
}

function commitMessageWithCoAuthor(message: string, coAuthor?: { name: string; email: string } | null): string {
  const base = (message || "Update from dashboard").trim();
  if (!coAuthor?.name || !coAuthor.email) return base;
  const footer = `Co-authored-by: ${coAuthor.name} <${coAuthor.email}>`;
  return base.includes(footer) ? base : `${base}\n\n${footer}`;
}

export function githubTokenGitArgs(token: string, args: string[]): string[] {
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

function githubTokenPushArgs(token: string, branch: string): string[] {
  return githubTokenGitArgs(token, ["push", "-u", "origin", branch]);
}

export function push(
  directory: string,
  commitMessage = "",
  branchOrOptions?: string | GitPushOptions,
): { success: boolean; message: string; commit_hash: string } {
  const options: GitPushOptions = typeof branchOrOptions === "string"
    ? { branch: branchOrOptions }
    : (branchOrOptions || {});
  let branch = options.branch;

  if (!isGitInitialized(directory)) {
    return { success: false, message: "Git not initialized", commit_hash: "" };
  }
  try {
    const remote = runGitSafe(directory, ["remote", "get-url", "origin"]);
    if (remote.returncode !== 0) {
      return { success: false, message: "No remote configured. Connect to GitHub first.", commit_hash: "" };
    }

    ensureGitignore(directory);
    runGitSafe(directory, ["add", "-A"]);

    const diff = runGitSafe(directory, ["diff", "--cached", "--quiet"]);
    if (diff.returncode !== 0) {
      const msg = commitMessageWithCoAuthor(commitMessage, options.coAuthor);
      const commitArgs = ["commit"];
      if (options.author?.name && options.author.email) {
        commitArgs.push("--author", `${options.author.name} <${options.author.email}>`);
      }
      commitArgs.push("-m", msg);
      const commitResult = runGitSafe(directory, commitArgs);
      if (commitResult.returncode !== 0) {
        return { success: false, message: `Commit failed: ${commitResult.stdout}`, commit_hash: "" };
      }
    }

    if (!branch) {
      const br = runGitSafe(directory, ["branch", "--show-current"]);
      branch = br.stdout.trim() || "main";
    }

    if (branch === "main" || branch === "master") {
      return { success: false, message: "Cannot push directly to the main branch. Use a worktree and create a PR instead.", commit_hash: "" };
    }

    const pushResult = runGitSafe(
      directory,
      options.token ? githubTokenPushArgs(options.token, branch) : ["push", "-u", "origin", branch],
    );
    if (pushResult.returncode !== 0) {
      let errorMsg = pushResult.stdout.trim();
      if (errorMsg.includes("could not read Username")) {
        errorMsg = "Authentication failed. Connect your GitHub account and ensure the GitHub App has repository Contents access.";
      } else if (errorMsg.includes("Permission denied")) {
        errorMsg = "Authentication failed. Connect your GitHub account and ensure you have repository write access.";
      } else if (errorMsg.includes("not found")) {
        errorMsg = "Repository not found. Create the repo on GitHub first.";
      }
      return { success: false, message: errorMsg, commit_hash: "" };
    }

    const head = runGitSafe(directory, ["rev-parse", "--short", "HEAD"]);
    const commitHash = head.returncode === 0 ? head.stdout.trim() : "";

    return { success: true, message: "Pushed to GitHub successfully", commit_hash: commitHash };
  } catch (e: any) {
    return { success: false, message: String(e), commit_hash: "" };
  }
}

export function rebaseFromMain(worktreeDir: string): { success: boolean; message: string } {
  // 1. Fetch latest main from origin
  const fetch = runGitSafe(worktreeDir, ["fetch", "origin", "main:refs/remotes/origin/main"], 15000);
  if (fetch.returncode !== 0) {
    return { success: false, message: `Failed to fetch main: ${fetch.stdout || "check that origin remote is configured and accessible"}` };
  }

  // 2. Check if there are uncommitted changes — stash them
  const status = runGitSafe(worktreeDir, ["status", "--porcelain"]);
  const hasChanges = status.stdout.trim().length > 0;
  if (hasChanges) {
    runGitSafe(worktreeDir, ["stash", "push", "-m", "auto-stash before rebase"]);
  }

  // 3. Rebase onto origin/main
  const rebase = runGitSafe(worktreeDir, ["rebase", "origin/main"], 30000);
  if (rebase.returncode !== 0) {
    // Abort rebase on conflict
    runGitSafe(worktreeDir, ["rebase", "--abort"]);
    // Restore stashed changes
    if (hasChanges) {
      runGitSafe(worktreeDir, ["stash", "pop"]);
    }
    return { success: false, message: "Rebase conflict detected. Resolve manually or try again after the conflicting PR is merged." };
  }

  // 4. Restore stashed changes
  if (hasChanges) {
    const pop = runGitSafe(worktreeDir, ["stash", "pop"]);
    if (pop.returncode !== 0) {
      return { success: true, message: "Rebased successfully but stash pop had conflicts. Check your working directory." };
    }
  }

  return { success: true, message: "Successfully rebased onto latest main" };
}
