import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

function git(directory: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf-8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" },
  }).trim();
}

function commitFile(directory: string, contents: string, message: string): string {
  fs.writeFileSync(path.join(directory, "app.js"), contents);
  git(directory, ["add", "app.js"]);
  git(directory, ["commit", "-m", message]);
  return git(directory, ["rev-parse", "HEAD"]);
}

function createRepo(): { directory: string; baseSha: string; headSha: string } {
  const directory = path.join(ctx.tmpDir, "review-repo");
  fs.mkdirSync(directory, { recursive: true });
  git(directory, ["init", "-b", "main"]);
  git(directory, ["config", "user.name", "Test"]);
  git(directory, ["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({
    name: "review-fixture",
    scripts: {
      typecheck: "node -e \"process.exit(0)\"",
      test: "node -e \"process.exit(0)\"",
    },
  }, null, 2));
  fs.writeFileSync(path.join(directory, "app.js"), "module.exports = 1;\n");
  git(directory, ["add", "."]);
  git(directory, ["commit", "-m", "base"]);
  const baseSha = git(directory, ["rev-parse", "HEAD"]);

  fs.writeFileSync(path.join(directory, "app.js"), "module.exports = 2;\n");
  git(directory, ["add", "app.js"]);
  git(directory, ["commit", "-m", "head"]);
  const headSha = git(directory, ["rev-parse", "HEAD"]);
  return { directory, baseSha, headSha };
}

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("pull-request-review-jobs-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
  vi.restoreAllMocks();
});

describe("pull request review jobs", () => {
  it("reviews the exact head in an isolated worktree and cleans it up", async () => {
    const repo = createRepo();
    const app = seedApp(db, { name: "Review Fixture", directory: repo.directory });
    const dal = await import("@/lib/server/dal");
    dal.upsertGitHubInstallation({ installation_id: 5001, account_login: "acme" });
    dal.upsertProjectRepository({
      app_id: app.id,
      installation_id: 5001,
      owner: "acme",
      repo: "review-fixture",
    });

    const queued = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "review-job-delivery",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 5001,
      owner: "acme",
      repo: "review-fixture",
      pr_number: 7,
      base_sha: repo.baseSha,
      head_sha: repo.headSha,
      requested_reviewer_login: "archie",
      payload_json: "{}",
    });
    expect(queued.review?.status).toBe("queued");

    const { runPullRequestReviewNow } = await import("@/lib/server/pull-request-review-jobs");
    const completed = await runPullRequestReviewNow(queued.review!.id, { checksOnly: true });
    expect(completed.status).toBe("completed");
    expect(completed.execution_mode).toBe("isolated_worktree");
    expect(completed.workspace_path).toBeNull();
    expect(completed.comparison_sha).toBe(repo.headSha);
    expect(completed.context_sources_json).toContain("isolated_worktree");

    const execution = JSON.parse(completed.execution_json);
    expect(execution.phase).toBe("checks_completed");
    expect(execution.cleanup).toBe("completed");
    expect(execution.failed).toBe(0);
    const worktreeList = git(repo.directory, ["worktree", "list", "--porcelain"]);
    expect((worktreeList.match(/^worktree /gm) || []).length).toBe(1);
    const { reviewWorktreeRoot } = await import("@/lib/server/review-worktrees");
    const reviewRoot = reviewWorktreeRoot(repo.directory);
    expect(reviewRoot).toBe(path.join(ctx.tmpDir, "review-repo-review-worktrees"));
    expect(fs.existsSync(path.join(reviewRoot, ".archie-review-worktrees"))).toBe(true);
    expect(fs.readdirSync(reviewRoot).filter((entry) => entry.startsWith("review-"))).toEqual([]);
  });

  it("sweeps completed review worktrees on startup while preserving queued reviews", async () => {
    const repo = createRepo();
    const app = seedApp(db, { name: "Startup Sweep Fixture", directory: repo.directory });
    const dal = await import("@/lib/server/dal");
    dal.upsertGitHubInstallation({ installation_id: 5010, account_login: "acme" });
    dal.upsertProjectRepository({
      app_id: app.id,
      installation_id: 5010,
      owner: "acme",
      repo: "startup-sweep-fixture",
    });

    const completed = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "startup-sweep-completed",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 5010,
      owner: "acme",
      repo: "startup-sweep-fixture",
      pr_number: 10,
      base_sha: repo.baseSha,
      head_sha: repo.headSha,
      requested_reviewer_login: "archie",
      payload_json: "{}",
    }).review!;
    dal.updatePullRequestReview(completed.id, { status: "completed", completed_at: new Date().toISOString() });
    const queued = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "startup-sweep-queued",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 5010,
      owner: "acme",
      repo: "startup-sweep-fixture",
      pr_number: 11,
      base_sha: repo.baseSha,
      head_sha: repo.headSha,
      requested_reviewer_login: "archie",
      payload_json: "{}",
    }).review!;

    const worktreeHelpers = await import("@/lib/server/review-worktrees");
    const completedWorktree = worktreeHelpers.createReviewWorktree({
      appDirectory: repo.directory,
      reviewId: completed.id,
      headSha: repo.headSha,
    }).worktree!;
    const queuedWorktree = worktreeHelpers.createReviewWorktree({
      appDirectory: repo.directory,
      reviewId: queued.id,
      headSha: repo.headSha,
    }).worktree!;

    const { sweepReviewWorktreesOnStartup } = await import("@/lib/server/pull-request-review-jobs");
    expect(sweepReviewWorktreesOnStartup()).toEqual({ removed: 1, kept: 1, warnings: [] });
    expect(fs.existsSync(completedWorktree.worktree_dir)).toBe(false);
    expect(fs.existsSync(queuedWorktree.worktree_dir)).toBe(true);

    worktreeHelpers.removeReviewWorktree(queuedWorktree, repo.directory);
  });

  it("uses the previous completed review head for a targeted rerun", async () => {
    const repo = createRepo();
    const newHeadSha = commitFile(repo.directory, "module.exports = 3;\n", "follow-up");
    const app = seedApp(db, { name: "Targeted Review Fixture", directory: repo.directory });
    const dal = await import("@/lib/server/dal");
    dal.upsertGitHubInstallation({ installation_id: 5002, account_login: "acme" });
    dal.upsertProjectRepository({
      app_id: app.id,
      installation_id: 5002,
      owner: "acme",
      repo: "targeted-review-fixture",
    });

    const previous = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "targeted-previous-review",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 5002,
      owner: "acme",
      repo: "targeted-review-fixture",
      pr_number: 8,
      base_sha: repo.baseSha,
      head_sha: repo.headSha,
      requested_reviewer_login: "archie",
      payload_json: "{}",
    });
    dal.updatePullRequestReview(previous.review!.id, { status: "completed", completed_at: new Date().toISOString() });
    dal.createReviewFinding({
      review_id: previous.review!.id,
      path: "app.js",
      line: 1,
      title: "Previous concern",
      body: "The previous implementation needed a guard before using this changed value.",
      evidence_json: JSON.stringify({ line: 1 }),
    });
    const queued = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "targeted-follow-up-review",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 5002,
      owner: "acme",
      repo: "targeted-review-fixture",
      pr_number: 8,
      base_sha: repo.baseSha,
      head_sha: newHeadSha,
      requested_reviewer_login: "archie",
      review_mode: "targeted",
      previous_review_id: previous.review!.id,
      payload_json: "{}",
    });

    db.prepare("INSERT INTO system_settings (key, value_json) VALUES (?, ?), (?, ?)").run(
      "github_app_id", JSON.stringify("3779880"),
      "github_app_private_key", JSON.stringify("test-private-key"),
    );
    const githubApp = await import("@/lib/server/github-app");
    const githubApi = await import("@/lib/server/github-review-api");
    vi.spyOn(githubApp, "getGitHubAppInstallationToken").mockResolvedValue({ token: "installation-token", expires_at: "2099-01-01T00:00:00.000Z" });
    vi.spyOn(githubApi, "loadGitHubReviewContext").mockResolvedValue({
      pull_request: {
        number: 8,
        html_url: "https://github.com/acme/targeted-review-fixture/pull/8",
        title: "Targeted review",
        body: "",
        base: { ref: "main", sha: repo.baseSha },
        head: { ref: "feature", sha: newHeadSha },
      },
      files: [{ filename: "app.js", status: "modified", additions: 1, deletions: 1, changes: 2, patch: "@@ -1 +1 @@\n-module.exports = 1;\n+module.exports = 3;" }],
      diff: "full PR diff should not be used",
      checks: [],
      issue_comments: [],
      review_comments: [],
      reviews: [],
      warnings: [],
    });
    vi.spyOn(githubApi, "publishGitHubReview").mockResolvedValue({ id: 901, html_url: null, submitted_at: null, comments: [] });

    const { runPullRequestReviewNow } = await import("@/lib/server/pull-request-review-jobs");
    const completed = await runPullRequestReviewNow(queued.review!.id, {
      modelRunner: async (_prompt, phase) => JSON.stringify(phase === "verify"
        ? {
          summary: "One advisory compatibility finding is publishable.",
          findings: [{
            path: "missing.js",
            line: 1,
            title: "Invalid candidate",
            body: "This candidate points to a file outside the changed files and must be rejected.",
            evidence: "Missing file",
          }],
        }
        : { summary: "Candidate", findings: [] }),
    });

    expect(completed.status).toBe("completed");
    expect(completed.comparison_sha).toBe(repo.headSha);
    const context = JSON.parse(completed.context_packet_json);
    expect(context.review.comparison_sha).toBe(repo.headSha);
    expect(context.diff).toContain("-module.exports = 2;");
    expect(context.diff).toContain("+module.exports = 3;");
    expect(context.diff).not.toContain("-module.exports = 1;");
    expect(context.files[0].patch).toContain("-module.exports = 2;");
    expect(context.files[0].patch).not.toContain("-module.exports = 1;");
    expect(context.previous_findings).toMatchObject([{ path: "app.js", title: "Previous concern" }]);
    expect(context.sources).toContain("previous_archie_findings");
    expect(JSON.parse(completed.model_usage_json || "{}")).toMatchObject({
      findings: 0,
      validation_rejections: [{ path: "missing.js", reason: "file_not_in_changed_files" }],
      model_calls: 2,
      cost_usd: null,
      usage: null,
      cost_status: "unavailable_from_ephemeral_provider",
    });
    const publication = JSON.parse(completed.publication_json);
    expect(publication.comments).toHaveLength(0);
  });

  it("marks a failed review terminally and publishes a visible retry message", async () => {
    const app = seedApp(db, { name: "Missing Checkout", directory: "" });
    const dal = await import("@/lib/server/dal");
    dal.upsertGitHubInstallation({ installation_id: 5003, account_login: "acme" });
    dal.upsertProjectRepository({ app_id: app.id, installation_id: 5003, owner: "acme", repo: "missing-checkout" });
    const queued = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "review-job-failure",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 5003,
      owner: "acme",
      repo: "missing-checkout",
      pr_number: 9,
      base_sha: "base",
      head_sha: "head",
      requested_reviewer_login: "archie",
      payload_json: "{}",
    });

    const githubApp = await import("@/lib/server/github-app");
    const githubApi = await import("@/lib/server/github-review-api");
    vi.spyOn(githubApp, "getGitHubAppInstallationToken").mockResolvedValue({ token: "installation-token", expires_at: "2099-01-01T00:00:00.000Z" });
    const commentSpy = vi.spyOn(githubApi, "createGitHubIssueComment").mockResolvedValue({ id: 990, html_url: "https://github.com/acme/missing-checkout/pull/9#issuecomment-990" });

    const { runPullRequestReviewNow } = await import("@/lib/server/pull-request-review-jobs");
    const failed = await runPullRequestReviewNow(queued.review!.id);

    expect(failed.status).toBe("failed");
    expect(failed.completed_at).not.toBeNull();
    expect(failed.error_text).toContain("no local directory");
    expect(commentSpy).toHaveBeenCalledWith(expect.objectContaining({
      issueNumber: 9,
      body: expect.stringContaining("review was not published"),
    }));
    expect(JSON.parse(failed.publication_json)).toMatchObject({ failure_comment: { id: 990 } });
  });

  it("never executes an untrusted package script with unrestricted host access", async () => {
    const repo = createRepo();
    const marker = path.join(ctx.tmpDir, "host-marker.txt");
    fs.writeFileSync(path.join(repo.directory, "package.json"), JSON.stringify({
      name: "malicious-review-fixture",
      scripts: {
        test: `node -e \"require('fs').writeFileSync('${marker}', 'escaped')\"`,
      },
    }));
    const { runReviewChecks } = await import("@/lib/server/review-checks");
    const checks = runReviewChecks({ worktreeDir: repo.directory, baseSha: repo.baseSha, headSha: repo.headSha });

    expect(fs.existsSync(marker)).toBe(false);
    expect(checks.find((check) => check.name === "test_script")?.status).not.toBe("passed");
  });
});
