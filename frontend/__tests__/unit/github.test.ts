import { describe, it, expect } from "vitest";
import { parseGitHubRemoteUrl } from "@/lib/server/github";

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
