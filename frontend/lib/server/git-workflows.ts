import { execSync } from "child_process";
import * as dal from "@/lib/server/dal";
import { getWorktreeCodeDiff } from "@/lib/server/demo";
import {
  getDefaultBranchName as getGitDefaultBranchName,
  getStatus as getGitStatus,
  isGitInitialized,
  pull as gitPull,
  push as gitPush,
} from "@/lib/server/git";
import {
  createPullRequest,
  getDefaultBranch,
  parseGitHubRemoteUrl,
  updatePullRequest,
} from "@/lib/server/github";
import {
  getArchieCoAuthor,
  getValidGitHubUserToken,
  githubAuthorFromConnection,
} from "@/lib/server/github-app";
import { generatePRDescription } from "@/lib/server/pr-description";
import { buildCommitMessagePrompt } from "@/lib/server/prompts/git";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import type { AppRow, WorkItemRow } from "@/lib/server/types";

export type PublishWorkItemMode = "push" | "publish_pr" | "update_pr";

export interface GitWorkflowUser {
  id: number;
  name: string;
}

export interface PublishWorkItemBranchResult {
  success: true;
  action: PublishWorkItemMode;
  message: string;
  chat_message: string;
  branch: string;
  commit_hash?: string;
  pr_url?: string;
  pr_number?: number;
}

export interface PullBranchResult {
  success: true;
  message: string;
  chat_message: string;
  branch: string;
}

export class GitWorkflowError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "GitWorkflowError";
  }
}

function requireApp(appId: number): AppRow {
  const app = dal.getApp(appId);
  if (!app) throw new GitWorkflowError("App not found", 404);
  return app;
}

function requireWorkItem(appId: number, workItemId: number): WorkItemRow {
  const workItem = dal.getWorkItem(workItemId);
  if (!workItem || workItem.app_id !== appId) {
    throw new GitWorkflowError("Work item not found", 404);
  }
  return workItem;
}

function getWorkItemGitDirectory(app: AppRow, workItem: WorkItemRow): { gitDir: string; branch: string } {
  const env = dal.getWorkItemEnv(workItem.id);
  const gitDir = env?.worktree_dir || app.directory;
  if (!gitDir) throw new GitWorkflowError("No directory available", 400);
  if (!env?.branch_name) throw new GitWorkflowError("Work item does not have a branch", 400);
  return { gitDir, branch: env.branch_name };
}

/**
 * Gets a summary of staged/unstaged changes for commit message generation.
 */
function getDiffSummary(gitDir: string): string {
  let diff = "";
  try {
    diff = execSync("git diff --cached --stat", {
      cwd: gitDir,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {}

  if (!diff) {
    try {
      diff = execSync("git diff --stat", {
        cwd: gitDir,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {}
  }

  let shortDiff = "";
  try {
    const source = diff ? "--cached" : "";
    shortDiff = execSync(`git diff ${source} --no-color`, {
      cwd: gitDir,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {}

  return `${diff}\n\n${shortDiff}`.slice(0, 15000);
}

function inferTypeFromKind(kind: string, title: string): string {
  const typeMap: Record<string, string> = {
    setup: "chore",
    feature: "feat",
    bug: "fix",
    task: "chore",
    walkthrough: "docs",
  };
  const type = typeMap[kind] || "chore";
  const desc = title
    .replace(/^Setup\s+/i, "set up ")
    .replace(/^./, (c) => c.toLowerCase());
  return `${type}: ${desc}`;
}

async function generateCommitMessage(
  gitDir: string,
  workItem: { title: string; kind: string; summary?: string | null },
): Promise<string> {
  const diffSummary = getDiffSummary(gitDir);
  if (!diffSummary.trim()) return inferTypeFromKind(workItem.kind, workItem.title);

  const prompt = buildCommitMessagePrompt({
    workItemTitle: workItem.title,
    workItemKind: workItem.kind,
    diffSummary,
  });

  try {
    const result = await runEphemeralQuery(prompt, { category: "quick" });
    return result.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
  } catch {
    return inferTypeFromKind(workItem.kind, workItem.title);
  }
}

function parsePrArtifact(workItemId: number): { pr_url?: string; pr_number?: number } {
  const artifact = dal.getArtifactByKind(workItemId, "pull_request");
  if (!artifact?.metadata_json) return {};
  try {
    const meta = JSON.parse(artifact.metadata_json);
    return {
      pr_url: typeof meta.pr_url === "string" ? meta.pr_url : undefined,
      pr_number: typeof meta.pr_number === "number" ? meta.pr_number : undefined,
    };
  } catch {
    return {};
  }
}

function conversationReflectionMessages(workItem: WorkItemRow): { role: string; content: string }[] {
  if (!workItem.primary_conversation_id) return [];
  return dal.getConversationMessages(workItem.primary_conversation_id).map((message) => ({
    role: message.role,
    content: message.body_md,
  }));
}

async function generatePullRequestBody(workItem: WorkItemRow, gitDir: string): Promise<string> {
  return generatePRDescription({
    task: { title: workItem.title, description: workItem.summary || undefined },
    codeDiff: getWorktreeCodeDiff(gitDir),
    reflectionMessages: conversationReflectionMessages(workItem),
  });
}

function getGitHubRemote(gitDir: string): { owner: string; repo: string } {
  const status = getGitStatus(gitDir);
  const parsed = status.remote_url ? parseGitHubRemoteUrl(status.remote_url) : null;
  if (!parsed) throw new GitWorkflowError("Remote URL is not a GitHub repository", 400);
  return parsed;
}

function formatPublishChatMessage(result: {
  branch: string;
  commitHash?: string;
  prNumber?: number;
  prUrl?: string;
  updatedPr?: boolean;
}): string {
  const lines = [`Pushed branch \`${result.branch}\` using the connected GitHub account.`];
  if (result.commitHash) lines.push(`Commit: \`${result.commitHash}\``);
  if (result.prNumber && result.prUrl) {
    lines.push(`${result.updatedPr ? "Updated" : "Created"} PR #${result.prNumber}: ${result.prUrl}`);
  }
  return lines.join("\n");
}

export async function publishWorkItemBranch({
  appId,
  workItemId,
  user,
  mode,
}: {
  appId: number;
  workItemId: number;
  user: GitWorkflowUser;
  mode: PublishWorkItemMode;
}): Promise<PublishWorkItemBranchResult> {
  const app = requireApp(appId);
  const workItem = requireWorkItem(appId, workItemId);
  const { gitDir, branch } = getWorkItemGitDirectory(app, workItem);

  const githubAuth = await getValidGitHubUserToken(user.id);
  const commitMessage = await generateCommitMessage(gitDir, workItem);
  const pushResult = gitPush(gitDir, commitMessage, {
    branch,
    author: githubAuthorFromConnection(githubAuth.connection, user.name),
    coAuthor: getArchieCoAuthor(),
    token: githubAuth.token,
  });

  if (!pushResult.success) {
    throw new GitWorkflowError(pushResult.message, 500);
  }

  if (mode === "push") {
    return {
      success: true,
      action: mode,
      message: pushResult.message,
      chat_message: formatPublishChatMessage({ branch, commitHash: pushResult.commit_hash }),
      branch,
      commit_hash: pushResult.commit_hash,
    };
  }

  const remote = getGitHubRemote(gitDir);
  const prMeta = parsePrArtifact(workItem.id);
  const body = await generatePullRequestBody(workItem, gitDir);

  if (mode === "update_pr" || prMeta.pr_number) {
    if (!prMeta.pr_number) {
      throw new GitWorkflowError("Work item does not have a PR. Create one first.", 400);
    }
    const updateResult = await updatePullRequest({
      owner: remote.owner,
      repo: remote.repo,
      pr_number: prMeta.pr_number,
      body,
      token: githubAuth.token,
    });
    if (!updateResult.success) {
      throw new GitWorkflowError(updateResult.message, 422);
    }
    return {
      success: true,
      action: mode,
      message: updateResult.message,
      chat_message: formatPublishChatMessage({
        branch,
        commitHash: pushResult.commit_hash,
        prNumber: prMeta.pr_number,
        prUrl: prMeta.pr_url,
        updatedPr: true,
      }),
      branch,
      commit_hash: pushResult.commit_hash,
      pr_number: prMeta.pr_number,
      pr_url: prMeta.pr_url,
    };
  }

  const base = await getDefaultBranch({ owner: remote.owner, repo: remote.repo, token: githubAuth.token });
  const createResult = await createPullRequest({
    owner: remote.owner,
    repo: remote.repo,
    title: workItem.title,
    body,
    head: branch,
    base,
    token: githubAuth.token,
  });
  if (!createResult.success || !createResult.pr_number || !createResult.pr_url) {
    throw new GitWorkflowError(createResult.message, 422);
  }

  dal.createArtifact({
    app_id: appId,
    work_item_id: workItem.id,
    kind: "pull_request",
    name: `PR #${createResult.pr_number}`,
    storage_type: "inline",
    metadata_json: JSON.stringify({
      pr_url: createResult.pr_url,
      pr_number: createResult.pr_number,
      author_user_id: user.id,
    }),
  });

  if (workItem.primary_conversation_id) {
    dal.addSystemMessage(workItem.primary_conversation_id, `PR #${createResult.pr_number} created - ${createResult.pr_url}`);
  }

  return {
    success: true,
    action: mode,
    message: createResult.message,
    chat_message: formatPublishChatMessage({
      branch,
      commitHash: pushResult.commit_hash,
      prNumber: createResult.pr_number,
      prUrl: createResult.pr_url,
    }),
    branch,
    commit_hash: pushResult.commit_hash,
    pr_number: createResult.pr_number,
    pr_url: createResult.pr_url,
  };
}

export async function pullWorkItemBranch({
  appId,
  workItemId,
  user,
}: {
  appId: number;
  workItemId: number;
  user: GitWorkflowUser;
}): Promise<PullBranchResult> {
  const app = requireApp(appId);
  const workItem = requireWorkItem(appId, workItemId);
  const { gitDir, branch } = getWorkItemGitDirectory(app, workItem);
  const githubAuth = await getValidGitHubUserToken(user.id);
  const result = gitPull(gitDir, {
    branch,
    token: githubAuth.token,
    fastForwardOnly: true,
    requireClean: true,
    allowDefaultBranchHardReset: false,
    allowDeletedBranchFallback: false,
  });
  if (!result.success) throw new GitWorkflowError(result.message, 409);
  return {
    success: true,
    message: result.message,
    chat_message: `${result.message} on \`${branch}\`.`,
    branch,
  };
}

export async function pullAppDefaultBranch({
  appId,
  user,
  branch,
}: {
  appId: number;
  user: GitWorkflowUser;
  branch?: string;
}): Promise<PullBranchResult> {
  const app = requireApp(appId);
  if (!app.directory) throw new GitWorkflowError("App has no directory configured", 400);
  if (!isGitInitialized(app.directory)) throw new GitWorkflowError("Git not initialized", 400);

  const branchName = branch || getGitDefaultBranchName(app.directory);
  const githubAuth = await getValidGitHubUserToken(user.id);
  const result = gitPull(app.directory, {
    branch: branchName,
    token: githubAuth.token,
    fastForwardOnly: true,
    requireClean: true,
    allowDefaultBranchHardReset: false,
  });
  if (!result.success) throw new GitWorkflowError(result.message, 409);

  return {
    success: true,
    message: result.message,
    chat_message: `${result.message} on \`${branchName}\`.`,
    branch: branchName,
  };
}
