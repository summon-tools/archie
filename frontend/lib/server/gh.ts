/**
 * gh CLI wrapper — gh-first GitHub integration.
 * All GitHub operations go through the gh CLI, which handles auth.
 */

import { execSync } from "child_process";
import os from "os";

// Ensure common tool paths (Homebrew, nix, etc.) are on PATH for child processes
const EXTRA_PATHS = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
const currentPath = process.env.PATH || "";
const mergedPath = [...new Set([...EXTRA_PATHS, ...currentPath.split(":")])].join(":");

const EXEC_OPTS = {
  encoding: "utf-8" as const,
  timeout: 30000,
  stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
  shell: "bash" as const,
  env: { ...process.env, HOME: os.homedir(), PATH: mergedPath },
};

// --- Auth ---

export interface GhAuthStatus {
  authenticated: boolean;
  user: string | null;
  host: string | null;
}

export function ghIsInstalled(): boolean {
  try {
    execSync("gh --version", { ...EXEC_OPTS, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function ghAuthStatus(): GhAuthStatus {
  try {
    const raw = execSync("gh auth status 2>&1", { ...EXEC_OPTS, shell: "bash" });
    // gh auth status outputs to stderr, but we capture both.
    // When authenticated: "✓ Logged in to github.com account username (..."
    const userMatch = raw.match(/account\s+(\S+)/);
    const hostMatch = raw.match(/Logged in to\s+(\S+)/);
    return {
      authenticated: raw.includes("Logged in"),
      user: userMatch ? userMatch[1] : null,
      host: hostMatch ? hostMatch[1] : "github.com",
    };
  } catch (e: any) {
    // gh auth status returns exit code 1 when not authenticated
    const output = (e.stderr || e.stdout || "").toString();
    if (output.includes("not logged in") || output.includes("No accounts")) {
      return { authenticated: false, user: null, host: null };
    }
    return { authenticated: false, user: null, host: null };
  }
}

// --- PR Operations ---

export interface GhPrCreateResult {
  success: boolean;
  message: string;
  pr_url: string;
  pr_number: number;
}

export function ghPrCreate(
  directory: string,
  title: string,
  body: string,
  base?: string,
): GhPrCreateResult {
  try {
    const baseArg = base ? `--base "${base}"` : "";
    // gh pr create prints the PR URL on success (no --json support)
    const result = execSync(
      `gh pr create --title "${title.replace(/"/g, '\\"')}" --body-file - ${baseArg}`,
      { ...EXEC_OPTS, cwd: directory, input: body, shell: "bash" },
    );
    const prUrl = result.trim();
    // Extract PR number from URL: https://github.com/owner/repo/pull/123
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;
    return {
      success: true,
      message: "Pull request created",
      pr_url: prUrl,
      pr_number: prNumber,
    };
  } catch (e: any) {
    const output = (e.stderr || e.stdout || e.message || "").toString();
    // If a PR already exists, try to find it
    if (output.includes("already exists")) {
      const existing = ghPrView(directory);
      if (existing) {
        return {
          success: true,
          message: "Pull request already exists",
          pr_url: existing.pr_url,
          pr_number: existing.pr_number,
        };
      }
    }
    return { success: false, message: output.slice(0, 500), pr_url: "", pr_number: 0 };
  }
}

export interface GhPrEditResult {
  success: boolean;
  message: string;
}

export function ghPrEdit(
  directory: string,
  prNumber: number,
  opts: { title?: string; body?: string },
): GhPrEditResult {
  try {
    const args: string[] = [];
    if (opts.title) args.push(`--title "${opts.title.replace(/"/g, '\\"')}"`);

    let input: string | undefined;
    if (opts.body !== undefined) {
      args.push("--body-file -");
      input = opts.body;
    }

    execSync(
      `gh pr edit ${prNumber} ${args.join(" ")}`,
      { ...EXEC_OPTS, cwd: directory, input, shell: "bash" },
    );
    return { success: true, message: "Pull request updated" };
  } catch (e: any) {
    return { success: false, message: (e.stderr || e.message || "").toString().slice(0, 500) };
  }
}

export interface GhPrInfo {
  pr_url: string;
  pr_number: number;
  state: string;
  title: string;
}

export function ghPrView(directory: string): GhPrInfo | null {
  try {
    const result = execSync(
      "gh pr view --json url,number,state,title",
      { ...EXEC_OPTS, cwd: directory, shell: "bash" },
    );
    const parsed = JSON.parse(result.trim());
    return {
      pr_url: parsed.url,
      pr_number: parsed.number,
      state: parsed.state,
      title: parsed.title,
    };
  } catch {
    return null;
  }
}

// --- Repo Info ---

export interface GhRepoInfo {
  owner: string;
  repo: string;
  default_branch: string;
}

export function ghRepoView(directory: string): GhRepoInfo | null {
  try {
    const result = execSync(
      "gh repo view --json owner,name,defaultBranchRef",
      { ...EXEC_OPTS, cwd: directory, shell: "bash" },
    );
    const parsed = JSON.parse(result.trim());
    return {
      owner: parsed.owner?.login || parsed.owner,
      repo: parsed.name,
      default_branch: parsed.defaultBranchRef?.name || "main",
    };
  } catch {
    return null;
  }
}

// --- Credential Setup ---

/**
 * Configures git to use gh as the credential helper for GitHub HTTPS remotes.
 * This makes `git push` work without SSH keys.
 */
export function ghSetupGitCredential(): boolean {
  try {
    execSync("gh auth setup-git", { ...EXEC_OPTS, shell: "bash" });
    return true;
  } catch {
    return false;
  }
}
