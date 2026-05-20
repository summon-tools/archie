import { describe, expect, it } from "vitest";
import { detectGitChatIntent } from "@/lib/server/chat-git-intents";

describe("detectGitChatIntent", () => {
  it("detects commit and push requests", () => {
    expect(detectGitChatIntent("commit and push").type).toBe("push");
  });

  it("detects create pull request requests", () => {
    expect(detectGitChatIntent("create a pull request").type).toBe("publish_pr");
  });

  it("detects update PR requests", () => {
    expect(detectGitChatIntent("update the PR").type).toBe("update_pr");
  });

  it("detects pull latest requests", () => {
    expect(detectGitChatIntent("pull latest").type).toBe("pull_worktree");
  });

  it("does not intercept questions about creating PRs", () => {
    expect(detectGitChatIntent("how do I create a PR?").type).toBe("none");
  });

  it("does not treat pull request wording as git pull", () => {
    expect(detectGitChatIntent("what is the pull request status?").type).toBe("none");
  });

  it("detects default branch pull requests separately", () => {
    expect(detectGitChatIntent("pull latest main").type).toBe("pull_app_default");
  });
});
