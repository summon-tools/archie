import { afterEach, describe, it, expect, vi } from "vitest";
import { createPullRequest, parseGitHubRemoteUrl } from "@/lib/server/github";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseGitHubRemoteUrl", () => {
  it("parses SSH format with .git", () => {
    const result = parseGitHubRemoteUrl("git@github.com:owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses SSH format without .git", () => {
    const result = parseGitHubRemoteUrl("git@github.com:owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses HTTPS format with .git", () => {
    const result = parseGitHubRemoteUrl("https://github.com/owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses HTTPS format without .git", () => {
    const result = parseGitHubRemoteUrl("https://github.com/owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses HTTP format", () => {
    const result = parseGitHubRemoteUrl("http://github.com/owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("handles owner with hyphens and dots", () => {
    const result = parseGitHubRemoteUrl("git@github.com:my-org/my-repo.git");
    expect(result).toEqual({ owner: "my-org", repo: "my-repo" });
  });

  it("returns null for invalid URL", () => {
    expect(parseGitHubRemoteUrl("not-a-url")).toBeNull();
  });

  it("returns null for non-GitHub URL", () => {
    expect(parseGitHubRemoteUrl("git@gitlab.com:owner/repo.git")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGitHubRemoteUrl("")).toBeNull();
  });

  it("returns null for GitHub URL with extra path segments", () => {
    // The regex anchors to end, so extra segments should fail
    expect(parseGitHubRemoteUrl("https://github.com/owner/repo/tree/main")).toBeNull();
  });
});

describe("createPullRequest", () => {
  it("uses the branch name as the PR head for same-repo pull requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        number: 12,
        html_url: "https://github.com/owner/repo/pull/12",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createPullRequest({
      owner: "owner",
      repo: "repo",
      title: "Add feature",
      body: "Body",
      head: "task/5-add-feature",
      base: "main",
      token: "token",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      head: "task/5-add-feature",
      base: "main",
    });
  });

  it("explains GitHub App PR permission issues when GitHub returns not found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({
        "x-accepted-github-permissions": "pull_requests=write",
      }),
      json: async () => ({ message: "Not Found" }),
    }));

    const result = await createPullRequest({
      owner: "owner",
      repo: "repo",
      title: "Add feature",
      head: "task/5-add-feature",
      base: "main",
      token: "token",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Pull requests: Read and write");
    expect(result.message).toContain("reinstall or approve");
    expect(result.message).toContain("pull_requests=write");
  });
});
