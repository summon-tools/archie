import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { push as gitPush } from "@/lib/server/git";
import { execSync } from "child_process";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import { buildCommitMessagePrompt } from "@/lib/server/prompts/git";
import {
  getArchieCoAuthor,
  getValidGitHubUserToken,
  githubAuthorFromConnection,
  GitHubAppError,
} from "@/lib/server/github-app";

/**
 * Gets a summary of staged/unstaged changes for commit message generation.
 */
function getDiffSummary(gitDir: string): string {
  // Try staged first
  let diff = "";
  try {
    diff = execSync("git diff --cached --stat", {
      cwd: gitDir, encoding: "utf-8", timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {}

  // If nothing staged, check unstaged (push will stage everything)
  if (!diff) {
    try {
      diff = execSync("git diff --stat", {
        cwd: gitDir, encoding: "utf-8", timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {}
  }

  // Also get a short diff for context (truncated)
  let shortDiff = "";
  try {
    const source = diff ? "--cached" : "";
    shortDiff = execSync(`git diff ${source} --no-color`, {
      cwd: gitDir, encoding: "utf-8", timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {}

  return `${diff}\n\n${shortDiff}`.slice(0, 15000);
}

/**
 * Generates a Conventional Commits message using the LLM.
 * Format: type(optional-scope): short description
 */
async function generateCommitMessage(
  gitDir: string,
  workItem: { title: string; kind: string; summary?: string | null },
): Promise<string> {
  const diffSummary = getDiffSummary(gitDir);

  if (!diffSummary.trim()) {
    // Fallback: no diff available, use work item title
    return inferTypeFromKind(workItem.kind, workItem.title);
  }

  const prompt = buildCommitMessagePrompt({
    workItemTitle: workItem.title,
    workItemKind: workItem.kind,
    diffSummary,
  });

  try {
    const result = await runEphemeralQuery(prompt, {
      category: "quick",
    });
    // Clean up: remove any markdown fences or extra whitespace
    return result.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
  } catch {
    // Fallback if LLM fails
    return inferTypeFromKind(workItem.kind, workItem.title);
  }
}

/**
 * Simple fallback: infer commit type from work item kind.
 */
function inferTypeFromKind(kind: string, title: string): string {
  const typeMap: Record<string, string> = {
    setup: "chore",
    feature: "feat",
    bug: "fix",
    task: "chore",
    walkthrough: "docs",
  };
  const type = typeMap[kind] || "chore";
  // Lowercase first letter, remove "Setup " prefix if present
  const desc = title
    .replace(/^Setup\s+/i, "set up ")
    .replace(/^./, (c) => c.toLowerCase());
  return `${type}: ${desc}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  let currentUser: Awaited<ReturnType<typeof getAuthUser>>;
  try {
    currentUser = await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  const { appId, itemId } = await params;

  const app = dal.getApp(Number(appId));
  if (!app) {
    return NextResponse.json({ detail: "App not found" }, { status: 404 });
  }

  const wi = dal.getWorkItem(Number(itemId));
  if (!wi || wi.app_id !== Number(appId)) {
    return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
  }

  const env = dal.getWorkItemEnv(wi.id);
  const gitDir = env?.worktree_dir || app.directory;
  if (!gitDir) {
    return NextResponse.json(
      { detail: "No directory available for push" },
      { status: 400 }
    );
  }

  // Generate a Conventional Commits message from the diff + work item context
  const commitMessage = await generateCommitMessage(gitDir, wi);

  let githubAuth;
  try {
    githubAuth = await getValidGitHubUserToken(currentUser.id);
  } catch (e) {
    if (e instanceof GitHubAppError) {
      return NextResponse.json({ detail: e.message }, { status: e.status });
    }
    throw e;
  }

  const author = githubAuthorFromConnection(githubAuth.connection, currentUser.name);
  const result = gitPush(gitDir, commitMessage, {
    author,
    coAuthor: getArchieCoAuthor(),
    token: githubAuth.token,
  });

  if (!result.success) {
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: result.message,
    commit_hash: result.commit_hash,
  });
}
