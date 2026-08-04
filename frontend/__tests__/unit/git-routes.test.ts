import { beforeEach, describe, expect, it, vi } from "vitest";

const authUser = { id: 123, name: "Test User", email: "test@example.com", role: "admin", color: null };

function mockRouteDependencies() {
  class AuthError extends Error {}
  class GitHubAppError extends Error {
    constructor(message: string, public readonly status = 400) {
      super(message);
    }
  }
  class GitWorkflowError extends Error {
    constructor(message: string, public readonly status = 400) {
      super(message);
    }
  }

  const publishWorkItemBranch = vi.fn(async () => ({
    success: true,
    action: "push",
    message: "Pushed to GitHub successfully",
    chat_message: "Pushed branch `task/test` using the connected GitHub account.",
    branch: "task/test",
    commit_hash: "abc1234",
    pr_url: "https://github.com/acme/repo/pull/7",
    pr_number: 7,
  }));
  const pullAppDefaultBranch = vi.fn(async () => ({
    success: true,
    message: "Already up to date",
    chat_message: "Already up to date on `main`.",
    branch: "main",
  }));
  const pullWorkItemBranch = vi.fn(async () => ({
    success: true,
    message: "Already up to date",
    chat_message: "Already up to date on `task/test`.",
    branch: "task/test",
  }));

  vi.doMock("@/lib/server/auth", () => ({
    getAuthUser: vi.fn(async () => authUser),
    AuthError,
  }));
  vi.doMock("@/lib/server/github-app", () => ({ GitHubAppError }));
  vi.doMock("@/lib/server/git-workflows", () => ({
    GitWorkflowError,
    publishWorkItemBranch,
    pullAppDefaultBranch,
    pullWorkItemBranch,
  }));

  return { publishWorkItemBranch, pullAppDefaultBranch, pullWorkItemBranch };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("git route workflow delegation", () => {
  it("uses the shared workflow for worktree push", async () => {
    const { publishWorkItemBranch } = mockRouteDependencies();
    const { POST } = await import("@/app/api/apps/[appId]/work-items/[itemId]/env/push/route");

    const response = await POST(new Request("http://test.local") as any, {
      params: Promise.resolve({ appId: "1", itemId: "2" }),
    });

    expect(response.status).toBe(200);
    expect(publishWorkItemBranch).toHaveBeenCalledWith({
      appId: 1,
      workItemId: 2,
      user: authUser,
      mode: "push",
    });
  });

  it("uses the shared workflow for PR creation", async () => {
    const { publishWorkItemBranch } = mockRouteDependencies();
    const { POST } = await import("@/app/api/apps/[appId]/work-items/[itemId]/env/create-pr/route");

    const response = await POST(new Request("http://test.local") as any, {
      params: Promise.resolve({ appId: "1", itemId: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pr_number).toBe(7);
    expect(publishWorkItemBranch).toHaveBeenCalledWith(expect.objectContaining({ mode: "publish_pr" }));
  });

  it("uses the shared workflow for PR updates", async () => {
    const { publishWorkItemBranch } = mockRouteDependencies();
    const { POST } = await import("@/app/api/apps/[appId]/work-items/[itemId]/env/update-pr/route");

    const response = await POST(new Request("http://test.local") as any, {
      params: Promise.resolve({ appId: "1", itemId: "2" }),
    });

    expect(response.status).toBe(200);
    expect(publishWorkItemBranch).toHaveBeenCalledWith(expect.objectContaining({ mode: "update_pr" }));
  });

  it("uses the shared workflow for app pulls", async () => {
    const { pullAppDefaultBranch } = mockRouteDependencies();
    const { POST } = await import("@/app/api/apps/[appId]/git/pull/route");

    const response = await POST(new Request("http://test.local", {
      method: "POST",
      body: JSON.stringify({ branch: "main" }),
    }) as any, {
      params: Promise.resolve({ appId: "1" }),
    });

    expect(response.status).toBe(200);
    expect(pullAppDefaultBranch).toHaveBeenCalledWith({
      appId: 1,
      user: authUser,
      branch: "main",
      discardLocalChanges: false,
    });
  });

  it("passes discard-local-changes option for app pulls", async () => {
    const { pullAppDefaultBranch } = mockRouteDependencies();
    const { POST } = await import("@/app/api/apps/[appId]/git/pull/route");

    const response = await POST(new Request("http://test.local", {
      method: "POST",
      body: JSON.stringify({ branch: "main", discardLocalChanges: true }),
    }) as any, {
      params: Promise.resolve({ appId: "1" }),
    });

    expect(response.status).toBe(200);
    expect(pullAppDefaultBranch).toHaveBeenCalledWith({
      appId: 1,
      user: authUser,
      branch: "main",
      discardLocalChanges: true,
    });
  });

  it("uses the shared workflow for worktree pulls", async () => {
    const { pullWorkItemBranch } = mockRouteDependencies();
    const { POST } = await import("@/app/api/apps/[appId]/work-items/[itemId]/env/pull/route");

    const response = await POST(new Request("http://test.local") as any, {
      params: Promise.resolve({ appId: "1", itemId: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.branch).toBe("task/test");
    expect(pullWorkItemBranch).toHaveBeenCalledWith({
      appId: 1,
      workItemId: 2,
      user: authUser,
    });
  });
});

describe("branch import route", () => {
  it("creates an empty task conversation for imported branches", async () => {
    const createConversation = vi.fn(() => ({
      id: 5,
      app_id: 1,
      kind: "task",
      title: "Branch: feature/existing",
      created_by: authUser.id,
    }));
    const createWorkItem = vi.fn((data: any) => ({
      id: 9,
      status: "in_progress",
      position: 0,
      created_at: "",
      updated_at: "",
      ...data,
    }));
    const createWorktreeFromBranch = vi.fn(() => ({
      success: true,
      message: "Worktree created",
      branch_name: "feature/existing",
      worktree_dir: "/repo-task-9",
    }));

    vi.doMock("@/lib/server/route-utils", () => ({
      requireAppAccess: vi.fn(async () => ({
        user: authUser,
        appId: 1,
        app: { id: 1, name: "Test App", directory: "/repo" },
      })),
      readJsonBody: vi.fn(async () => ({ branch: "feature/existing" })),
      handleRouteError: vi.fn(() => null),
    }));
    vi.doMock("@/lib/server/github-app", () => ({
      getValidGitHubUserToken: vi.fn(async () => ({ token: "user-token" })),
    }));
    vi.doMock("@/lib/server/dal", () => ({
      createConversation,
      createWorkItem,
      ensureWorkItemEnv: vi.fn(),
      updateWorkItemEnv: vi.fn(),
      deleteWorkItem: vi.fn(),
      deleteConversation: vi.fn(),
      getWorkItemEnv: vi.fn(() => ({
        branch_name: "feature/existing",
        worktree_dir: "/repo-task-9",
        worktree_status: "ready",
        branch_source: "imported",
        delete_branch_on_remove: 0,
      })),
      getSessionForConversation: vi.fn(() => null),
      getArtifactByKind: vi.fn(() => null),
    }));
    vi.doMock("@/lib/server/worktrees", () => ({ createWorktreeFromBranch }));
    vi.doMock("@/lib/server/work-item-view", () => ({
      enrichWorkItem: vi.fn((workItem) => workItem),
    }));
    vi.doMock("@/lib/server/conversation", () => ({
      isConversationRunning: vi.fn(() => false),
    }));

    const { POST } = await import("@/app/api/apps/[appId]/work-items/import-branch/route");

    const response = await POST(new Request("http://test.local") as any, {
      params: Promise.resolve({ appId: "1" }),
    });

    expect(response.status).toBe(201);
    expect(createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      title: "Branch: feature/existing",
      summary: "",
      kind: "task",
    }));
    expect(createWorktreeFromBranch).toHaveBeenCalledWith("/repo", 9, "feature/existing", {
      token: "user-token",
    });
  });
});
