import { beforeEach, describe, expect, it, vi } from "vitest";

function mockWorkflowDependencies() {
  const pull = vi.fn(() => ({ success: true, message: "Already up to date" }));
  const getDefaultBranchName = vi.fn(() => "main");
  const getValidGitHubUserToken = vi.fn(async () => ({
    token: "user-token",
    connection: {
      user_id: 1,
      github_user_id: 123,
      github_login: "test-user",
      github_name: "Test User",
      github_email: "test@example.com",
    },
  }));

  vi.doMock("@/lib/server/dal", () => ({
    getApp: vi.fn(() => ({
      id: 1,
      name: "Test App",
      port: 3001,
      description: "",
      directory: "/repo",
      github_repo: "acme/repo",
      project_owner_user_id: null,
      created_at: "",
    })),
    getWorkItem: vi.fn(() => ({
      id: 2,
      app_id: 1,
      primary_conversation_id: 5,
      title: "Test work",
      summary: "",
      kind: "task",
      status: "in_progress",
      position: 0,
      created_by: 1,
      assigned_to: null,
      legacy_task_id: null,
      completed_at: null,
      completed_by_user_id: null,
      origin_type: "user",
      origin_automation_key: null,
      origin_run_id: null,
      created_at: "",
      updated_at: "",
    })),
    getWorkItemEnv: vi.fn(() => ({
      work_item_id: 2,
      branch_name: "task/test",
      worktree_dir: "/repo-task",
      worktree_status: "ready",
      branch_source: "generated",
      delete_branch_on_remove: 1,
      preview_port: null,
      preview_pid: null,
    })),
  }));
  vi.doMock("@/lib/server/git", () => ({
    getDefaultBranchName,
    getStatus: vi.fn(),
    isGitInitialized: vi.fn(() => true),
    pull,
    push: vi.fn(),
  }));
  vi.doMock("@/lib/server/github-app", () => ({
    getArchieCoAuthor: vi.fn(() => null),
    getValidGitHubUserToken,
    githubAuthorFromConnection: vi.fn(() => ({ name: "Test User", email: "test@example.com", login: "test-user" })),
  }));

  return { pull, getDefaultBranchName, getValidGitHubUserToken };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("git workflows", () => {
  it("resolves the app default branch before app-level pulls", async () => {
    const { pull, getDefaultBranchName } = mockWorkflowDependencies();
    const { pullAppDefaultBranch } = await import("@/lib/server/git-workflows");

    await pullAppDefaultBranch({
      appId: 1,
      user: { id: 1, name: "Test User" },
    });

    expect(getDefaultBranchName).toHaveBeenCalledWith("/repo");
    expect(pull).toHaveBeenCalledWith("/repo", expect.objectContaining({
      branch: "main",
      fastForwardOnly: true,
      requireClean: true,
      allowDefaultBranchHardReset: false,
    }));
  });

  it("allows app-level default branch pulls to discard local changes when requested", async () => {
    const { pull } = mockWorkflowDependencies();
    const { pullAppDefaultBranch } = await import("@/lib/server/git-workflows");

    await pullAppDefaultBranch({
      appId: 1,
      user: { id: 1, name: "Test User" },
      discardLocalChanges: true,
    });

    expect(pull).toHaveBeenCalledWith("/repo", expect.objectContaining({
      branch: "main",
      requireClean: false,
      allowDefaultBranchHardReset: true,
    }));
  });

  it("rejects discard-local-changes pulls outside main or master", async () => {
    const { pull } = mockWorkflowDependencies();
    const { pullAppDefaultBranch } = await import("@/lib/server/git-workflows");

    await expect(pullAppDefaultBranch({
      appId: 1,
      user: { id: 1, name: "Test User" },
      branch: "feature/test",
      discardLocalChanges: true,
    })).rejects.toThrow("Discarding local changes is only supported on main or master.");

    expect(pull).not.toHaveBeenCalled();
  });

  it("disables deleted-branch fallback for worktree pulls", async () => {
    const { pull } = mockWorkflowDependencies();
    const { pullWorkItemBranch } = await import("@/lib/server/git-workflows");

    await pullWorkItemBranch({
      appId: 1,
      workItemId: 2,
      user: { id: 1, name: "Test User" },
    });

    expect(pull).toHaveBeenCalledWith("/repo-task", expect.objectContaining({
      branch: "task/test",
      allowDeletedBranchFallback: false,
    }));
  });
});
