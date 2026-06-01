import * as dal from "@/lib/server/dal";

export function getGitHubToken(): string | null {
  return dal.getSetting("github_token");
}

export function parseGitHubRemoteUrl(
  url: string
): { owner: string; repo: string } | null {
  url = url.trim().replace(/^https?:\/\/[^@]+@github\.com\//, "https://github.com/");
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  // HTTPS format: https://github.com/owner/repo(.git)
  const httpsMatch = url.match(
    /https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/
  );
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  return null;
}

const API_VERSION = "2022-11-28";

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

interface CreatePRParams {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  head: string;
  base: string;
  token: string;
}

interface PRResult {
  success: boolean;
  message: string;
  pr_url?: string;
  pr_number?: number;
}

function githubPullRequestErrorMessage({
  status,
  owner,
  repo,
  body,
  acceptedPermissions,
}: {
  status: number;
  owner: string;
  repo: string;
  body: any;
  acceptedPermissions?: string | null;
}): string {
  const details: string[] = [];
  if (body.message) details.push(body.message);
  if (body.errors?.length) {
    for (const err of body.errors) {
      const parts = [err.message, err.field, err.code].filter(Boolean);
      if (parts.length) details.push(parts.join(" — "));
    }
  }

  const fullError = details.join(": ") || `GitHub API error ${status}`;
  if (status === 404) {
    const permissionHint = acceptedPermissions
      ? ` GitHub says this endpoint accepts: ${acceptedPermissions}.`
      : "";
    return [
      `GitHub could not create the PR for ${owner}/${repo}.`,
      "Push can still work when Contents access is configured, but PR creation also needs the GitHub App installation to have Pull requests: Read and write.",
      "If you changed GitHub App permissions, reinstall or approve the updated installation for this repository, then reconnect/retry.",
      `${fullError}.${permissionHint}`,
    ].join(" ");
  }

  return fullError;
}

export async function getDefaultBranch({
  owner,
  repo,
  token,
}: {
  owner: string;
  repo: string;
  token: string;
}): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    {
      headers: githubHeaders(token),
    }
  );
  if (res.ok) {
    const data = await res.json();
    return data.default_branch || "main";
  }
  return "main";
}

export async function createPullRequest({
  owner,
  repo,
  title,
  body,
  head,
  base,
  token,
}: CreatePRParams): Promise<PRResult> {
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    ...githubHeaders(token),
    "Content-Type": "application/json",
  };

  // Try creating the PR
  const createRes = await fetch(`${apiBase}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title, body: body || "", head, base }),
  });

  if (createRes.ok) {
    const pr = await createRes.json();
    return {
      success: true,
      message: `Pull request #${pr.number} created`,
      pr_url: pr.html_url,
      pr_number: pr.number,
    };
  }

  // Read body once before any other async calls
  const errorBody = await createRes.json().catch(() => ({}));

  const fullError = githubPullRequestErrorMessage({
    status: createRes.status,
    owner,
    repo,
    body: errorBody,
    acceptedPermissions: createRes.headers.get("x-accepted-github-permissions"),
  });

  // 422 often means a PR already exists for this head branch
  if (createRes.status === 422) {
    const existing = await findExistingPR({ owner, repo, head, token });
    if (existing) {
      return existing;
    }
    return { success: false, message: fullError };
  }

  return { success: false, message: fullError };
}

export async function updatePullRequest({
  owner,
  repo,
  pr_number,
  title,
  body,
  token,
}: {
  owner: string;
  repo: string;
  pr_number: number;
  title?: string;
  body: string;
  token: string;
}): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pr_number}`,
    {
      method: "PATCH",
      headers: {
        ...githubHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...(title && { title }), body }),
    }
  );

  if (res.ok) {
    return { success: true, message: `PR #${pr_number} updated` };
  }

  const errorBody = await res.json().catch(() => ({}));
  return {
    success: false,
    message: errorBody.message || `GitHub API error ${res.status}`,
  };
}

export async function getPullRequest({
  owner,
  repo,
  pr_number,
  token,
}: {
  owner: string;
  repo: string;
  pr_number: number;
  token: string;
}): Promise<{ state: string; pr_url: string; pr_number: number; title: string } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pr_number}`,
    { headers: githubHeaders(token) },
  );
  if (!res.ok) return null;
  const pr = await res.json();
  return {
    state: pr.merged_at ? "MERGED" : String(pr.state || "unknown").toUpperCase(),
    pr_url: pr.html_url,
    pr_number: pr.number,
    title: pr.title,
  };
}

async function fetchAllGitHubPages<T>(url: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const currentUrl: string = nextUrl;
    const res: Response = await fetch(currentUrl, { headers: githubHeaders(token) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `GitHub API error ${res.status}`);
    }
    const page = await res.json();
    if (Array.isArray(page)) results.push(...page);
    const link: string = res.headers.get("link") || "";
    const nextMatch: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] : null;
  }
  return results;
}

export interface PullRequestEvidencePayload {
  pr: Record<string, any>;
  issue_comments: Array<Record<string, any>>;
  review_comments: Array<Record<string, any>>;
  reviews: Array<Record<string, any>>;
  commits: Array<Record<string, any>>;
}

export async function getPullRequestEvidence({
  owner,
  repo,
  pr_number,
  token,
}: {
  owner: string;
  repo: string;
  pr_number: number;
  token: string;
}): Promise<PullRequestEvidencePayload> {
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const prRes = await fetch(`${apiBase}/pulls/${pr_number}`, { headers: githubHeaders(token) });
  if (!prRes.ok) {
    const body = await prRes.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API error ${prRes.status}`);
  }

  const pr = await prRes.json();
  const [issue_comments, review_comments, reviews, commits] = await Promise.all([
    fetchAllGitHubPages<Record<string, any>>(`${apiBase}/issues/${pr_number}/comments?per_page=100`, token),
    fetchAllGitHubPages<Record<string, any>>(`${apiBase}/pulls/${pr_number}/comments?per_page=100`, token),
    fetchAllGitHubPages<Record<string, any>>(`${apiBase}/pulls/${pr_number}/reviews?per_page=100`, token),
    fetchAllGitHubPages<Record<string, any>>(`${apiBase}/pulls/${pr_number}/commits?per_page=100`, token),
  ]);

  return { pr, issue_comments, review_comments, reviews, commits };
}

/**
 * Upload a video as a GitHub release asset.
 * Creates/reuses a `demo-assets` release, then uploads the file.
 * Returns the browser_download_url for the asset.
 */
export async function uploadVideoToGitHub({
  owner,
  repo,
  videoPath,
  taskId,
  token,
}: {
  owner: string;
  repo: string;
  videoPath: string;
  taskId: number;
  token: string;
}): Promise<string> {
  const fs = await import("fs");
  const headers = githubHeaders(token);
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const tag = "demo-assets";

  // Find or create the demo-assets release
  let releaseId: number;
  const getRes = await fetch(`${apiBase}/releases/tags/${tag}`, { headers });
  if (getRes.ok) {
    const release = await getRes.json();
    releaseId = release.id;
  } else {
    const createRes = await fetch(`${apiBase}/releases`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        name: "Demo Assets",
        body: "Auto-generated release for demo video assets",
        draft: false,
        prerelease: false,
      }),
    });
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(err.message || `Failed to create release: ${createRes.status}`);
    }
    const release = await createRes.json();
    releaseId = release.id;
  }

  const assetName = `demo-task-${taskId}.mp4`;

  // Delete existing asset with same name (to allow re-upload)
  const assetsRes = await fetch(`${apiBase}/releases/${releaseId}/assets`, { headers });
  if (assetsRes.ok) {
    const assets = await assetsRes.json();
    for (const asset of assets) {
      if (asset.name === assetName) {
        await fetch(`${apiBase}/releases/assets/${asset.id}`, {
          method: "DELETE",
          headers,
        });
        break;
      }
    }
  }

  // Upload video as release asset
  const fileBuffer = fs.readFileSync(videoPath);
  const uploadRes = await fetch(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "video/mp4",
        "Content-Length": String(fileBuffer.length),
      },
      body: fileBuffer,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.message || `Failed to upload video: ${uploadRes.status}`);
  }

  const uploaded = await uploadRes.json();
  return uploaded.browser_download_url;
}

export async function findExistingPR({
  owner,
  repo,
  head,
  token,
}: {
  owner: string;
  repo: string;
  head: string;
  token: string;
}): Promise<PRResult | null> {
  const headParam = head.includes(":") ? head : `${owner}:${head}`;
  const searchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(headParam)}&state=open`,
    {
      headers: githubHeaders(token),
    }
  );

  if (!searchRes.ok) return null;

  const pulls = await searchRes.json();
  if (pulls.length > 0) {
    const pr = pulls[0];
    return {
      success: true,
      message: `Pull request #${pr.number} already exists`,
      pr_url: pr.html_url,
      pr_number: pr.number,
    };
  }
  return null;
}
