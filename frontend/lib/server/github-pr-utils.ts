import { parseGitHubRemoteUrl } from "@/lib/server/github";

export function parsePullRequestMetadata(metadataJson: string | null): {
  prNumber: number | null;
  prUrl: string | null;
  warnings: string[];
} {
  if (!metadataJson) {
    return { prNumber: null, prUrl: null, warnings: [] };
  }

  try {
    const parsed = JSON.parse(metadataJson);
    const rawNumber = parsed?.pr_number;
    const numberValue = typeof rawNumber === "number" ? rawNumber : Number(rawNumber);
    const prUrl = typeof parsed?.pr_url === "string" && parsed.pr_url.trim() ? parsed.pr_url.trim() : null;
    const urlNumberMatch = prUrl?.match(/\/pull\/(\d+)(?:[/?#].*)?$/);
    const parsedUrlNumber = urlNumberMatch ? Number(urlNumberMatch[1]) : null;
    const prNumber = Number.isInteger(numberValue) && numberValue > 0
      ? numberValue
      : parsedUrlNumber;
    const warnings: string[] = [];
    if (!prNumber) warnings.push("PR artifact is missing a valid PR number.");
    return { prNumber, prUrl, warnings };
  } catch {
    return { prNumber: null, prUrl: null, warnings: ["PR artifact metadata is not valid JSON."] };
  }
}

export function parseGitHubPullRequestUrl(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;
  const match = url.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+(?:[/?#].*)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

export function resolvePullRequestRepo(input: {
  appGithubRepo?: string | null;
  prUrl?: string | null;
}): { owner: string; repo: string } | null {
  return (input.appGithubRepo ? parseGitHubRemoteUrl(input.appGithubRepo) : null)
    || parseGitHubPullRequestUrl(input.prUrl || null);
}
