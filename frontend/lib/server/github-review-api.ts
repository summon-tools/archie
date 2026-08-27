import { githubApiHeaders } from "./github-app";

const API_ROOT = "https://api.github.com";
const MAX_BODY_LENGTH = 24000;
const MAX_DIFF_LENGTH = 120000;
const MAX_PATCH_LENGTH = 18000;

function repoUrl(owner: string, repo: string, suffix: string): string {
  return `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}

async function readJson(response: Response): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `GitHub API error ${response.status}`);
  }
  return data;
}

async function getJson(url: string, token: string): Promise<any> {
  return readJson(await fetch(url, { headers: githubApiHeaders(token) }));
}

async function getOptionalList(url: string, token: string, warnings: string[], label: string): Promise<Array<Record<string, any>>> {
  try {
    const data = await getJson(url, token);
    return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  } catch (error) {
    warnings.push(`${label}: ${error instanceof Error ? error.message : "request failed"}`);
    return [];
  }
}

async function getPagedList(url: string, token: string, warnings: string[], label: string): Promise<Array<Record<string, any>>> {
  const results: Array<Record<string, any>> = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    const pageUrl = `${url}${separator}per_page=100&page=${page}`;
    const pageItems = await getOptionalList(pageUrl, token, warnings, label);
    results.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  return results;
}

async function getPagedObjectList(
  url: string,
  token: string,
  warnings: string[],
  label: string,
  key: string,
): Promise<Array<Record<string, any>>> {
  const results: Array<Record<string, any>> = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    try {
      const data = await getJson(`${url}${separator}per_page=100&page=${page}`, token);
      const pageItems = Array.isArray(data?.[key]) ? data[key] : [];
      results.push(...pageItems);
      if (pageItems.length < 100) break;
    } catch (error) {
      warnings.push(`${label}: ${error instanceof Error ? error.message : "request failed"}`);
      break;
    }
  }
  return results;
}

export interface GitHubReviewFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
  previous_filename?: string;
}

export interface GitHubReviewContext {
  pull_request: Record<string, any>;
  files: GitHubReviewFile[];
  diff: string;
  checks: Array<Record<string, any>>;
  issue_comments: Array<Record<string, any>>;
  review_comments: Array<Record<string, any>>;
  reviews: Array<Record<string, any>>;
  warnings: string[];
}

export async function loadGitHubReviewContext(params: {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
}): Promise<GitHubReviewContext> {
  const warnings: string[] = [];
  const base = repoUrl(params.owner, params.repo, "");
  const pullRequest = await getJson(`${base}/pulls/${params.prNumber}`, params.token);
  const filesRaw = await getPagedList(`${base}/pulls/${params.prNumber}/files`, params.token, warnings, "changed files");
  const files = filesRaw.map((file) => ({
    filename: String(file.filename || ""),
    status: String(file.status || "modified"),
    additions: Number(file.additions || 0),
    deletions: Number(file.deletions || 0),
    changes: Number(file.changes || 0),
    patch: truncate(String(file.patch || ""), MAX_PATCH_LENGTH),
    ...(file.previous_filename ? { previous_filename: String(file.previous_filename) } : {}),
  })).filter((file) => file.filename);

  const [checksRaw, issue_comments, review_comments, reviews] = await Promise.all([
    getPagedObjectList(`${base}/commits/${encodeURIComponent(String(pullRequest.head?.sha || ""))}/check-runs`, params.token, warnings, "check runs", "check_runs"),
    getPagedList(`${base}/issues/${params.prNumber}/comments`, params.token, warnings, "issue comments"),
    getPagedList(`${base}/pulls/${params.prNumber}/comments`, params.token, warnings, "review comments"),
    getPagedList(`${base}/pulls/${params.prNumber}/reviews`, params.token, warnings, "reviews"),
  ]);

  let diff = "";
  try {
    const response = await fetch(`${base}/pulls/${params.prNumber}.diff`, {
      headers: { ...githubApiHeaders(params.token), Accept: "application/vnd.github.diff" },
    });
    if (response.ok) diff = truncate(await response.text(), MAX_DIFF_LENGTH);
    else warnings.push(`pull request diff: GitHub API error ${response.status}`);
  } catch (error) {
    warnings.push(`pull request diff: ${error instanceof Error ? error.message : "request failed"}`);
  }

  const checks = Array.isArray(checksRaw) ? checksRaw : [];
  return {
    pull_request: {
      number: pullRequest.number,
      html_url: pullRequest.html_url,
      title: truncate(String(pullRequest.title || ""), 4000),
      body: truncate(String(pullRequest.body || ""), MAX_BODY_LENGTH),
      state: pullRequest.state,
      draft: Boolean(pullRequest.draft),
      user: pullRequest.user?.login || null,
      base: { ref: pullRequest.base?.ref || null, sha: pullRequest.base?.sha || null },
      head: { ref: pullRequest.head?.ref || null, sha: pullRequest.head?.sha || null },
      additions: pullRequest.additions ?? null,
      deletions: pullRequest.deletions ?? null,
      changed_files: pullRequest.changed_files ?? null,
      created_at: pullRequest.created_at || null,
      updated_at: pullRequest.updated_at || null,
    },
    files,
    diff,
    checks: checks.map((check) => ({
      name: check.name || check.app?.name || "unknown",
      status: check.status || null,
      conclusion: check.conclusion || null,
      details_url: check.details_url || null,
      output: check.output?.title || null,
    })),
    issue_comments: issue_comments.slice(-50).map((comment) => ({
      id: comment.id,
      author: comment.user?.login || null,
      body: truncate(String(comment.body || ""), 6000),
      created_at: comment.created_at || null,
    })),
    review_comments: review_comments.slice(-100).map((comment) => ({
      id: comment.id,
      author: comment.user?.login || null,
      body: truncate(String(comment.body || ""), 6000),
      path: comment.path || null,
      line: comment.line || null,
      commit_id: comment.commit_id || null,
      created_at: comment.created_at || null,
    })),
    reviews: reviews.slice(-50).map((review) => ({
      id: review.id,
      author: review.user?.login || null,
      state: review.state || null,
      body: truncate(String(review.body || ""), 6000),
      submitted_at: review.submitted_at || null,
    })),
    warnings,
  };
}

export async function getGitHubRefSha(params: { owner: string; repo: string; ref: string; token: string }): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(params.ref)) return params.ref;
  const ref = params.ref.replace(/^refs\/heads\//, "");
  const data = await getJson(`${repoUrl(params.owner, params.repo, `/git/ref/heads/${encodeURIComponent(ref)}`)}`, params.token);
  const sha = data?.object?.sha;
  if (typeof sha !== "string" || !sha) throw new Error(`GitHub did not return a commit for ${params.ref}`);
  return sha;
}

export async function getGitHubPullRequestIdentity(params: {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
}): Promise<{ base_sha: string; head_sha: string }> {
  const data = await getJson(`${repoUrl(params.owner, params.repo, `/pulls/${params.prNumber}`)}`, params.token);
  const baseSha = data?.base?.sha;
  const headSha = data?.head?.sha;
  if (typeof baseSha !== "string" || !baseSha || typeof headSha !== "string" || !headSha) {
    throw new Error("GitHub did not return complete pull request commit identities.");
  }
  return { base_sha: baseSha, head_sha: headSha };
}

export async function getGitHubReviewCommentIdentity(params: {
  owner: string;
  repo: string;
  commentId: number;
  token: string;
}): Promise<{
  id: number;
  pull_request_review_id: number;
  path: string | null;
  line: number | null;
  body: string;
}> {
  const data = await getJson(
    `${repoUrl(params.owner, params.repo, `/pulls/comments/${params.commentId}`)}`,
    params.token,
  );
  if (!Number.isInteger(data?.id) || !Number.isInteger(data?.pull_request_review_id)) {
    throw new Error("GitHub did not return the root review comment identity.");
  }
  return {
    id: data.id,
    pull_request_review_id: data.pull_request_review_id,
    path: typeof data.path === "string" ? data.path : null,
    line: Number.isInteger(data.line) ? data.line : Number.isInteger(data.original_line) ? data.original_line : null,
    body: typeof data.body === "string" ? data.body : "",
  };
}

export async function getGitHubFileAtRef(params: { owner: string; repo: string; path: string; ref: string; token: string }): Promise<string> {
  const data = await getJson(
    `${repoUrl(params.owner, params.repo, `/contents/${params.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(params.ref)}`)}`,
    params.token,
  );
  if (data?.type !== "file" || typeof data.content !== "string") throw new Error(`GitHub path is not a file: ${params.path}`);
  return Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
}

export async function publishGitHubReview(params: {
  owner: string;
  repo: string;
  prNumber: number;
  commitId: string;
  body: string;
  comments: Array<{
    path: string;
    line: number;
    side: "LEFT" | "RIGHT";
    start_line?: number;
    start_side?: "LEFT" | "RIGHT";
    body: string;
  }>;
  token: string;
}): Promise<{
  id: number;
  html_url: string | null;
  submitted_at: string | null;
  comments: Array<{ id: number; path: string | null; line: number | null; html_url: string | null }>;
}> {
  const response = await fetch(`${repoUrl(params.owner, params.repo, `/pulls/${params.prNumber}/reviews`)}`, {
    method: "POST",
    headers: { ...githubApiHeaders(params.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      commit_id: params.commitId,
      body: params.body,
      event: "COMMENT",
      comments: params.comments,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Number.isInteger(data?.id)) {
    throw new Error(data?.message || `GitHub review publication failed (${response.status})`);
  }
  let comments = Array.isArray(data.comments) ? data.comments : [];
  if (!comments.length && params.comments.length) {
    const warnings: string[] = [];
    comments = await getPagedList(
      `${repoUrl(params.owner, params.repo, `/pulls/${params.prNumber}/reviews/${data.id}/comments`)}`,
      params.token,
      warnings,
      "published review comments",
    );
  }
  return {
    id: data.id,
    html_url: data.html_url || null,
    submitted_at: data.submitted_at || null,
    comments: comments.map((comment: any) => ({
      id: Number(comment.id),
      path: comment.path || null,
      line: comment.line || null,
      html_url: comment.html_url || null,
    })),
  };
}

export async function createGitHubIssueComment(params: {
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  token: string;
}): Promise<{ id: number; html_url: string | null }> {
  const response = await fetch(`${repoUrl(params.owner, params.repo, `/issues/${params.issueNumber}/comments`)}`, {
    method: "POST",
    headers: { ...githubApiHeaders(params.token), "Content-Type": "application/json" },
    body: JSON.stringify({ body: params.body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Number.isInteger(data?.id)) {
    throw new Error(data?.message || `GitHub issue comment failed (${response.status})`);
  }
  return { id: data.id, html_url: data.html_url || null };
}

export async function replyToGitHubReviewComment(params: {
  owner: string;
  repo: string;
  prNumber: number;
  commentId: number;
  body: string;
  token: string;
}): Promise<{ id: number; html_url: string | null }> {
  const response = await fetch(`${repoUrl(params.owner, params.repo, `/pulls/${params.prNumber}/comments/${params.commentId}/replies`)}`, {
    method: "POST",
    headers: { ...githubApiHeaders(params.token), "Content-Type": "application/json" },
    body: JSON.stringify({ body: params.body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Number.isInteger(data?.id)) {
    throw new Error(data?.message || `GitHub thread reply failed (${response.status})`);
  }
  return { id: data.id, html_url: data.html_url || null };
}
