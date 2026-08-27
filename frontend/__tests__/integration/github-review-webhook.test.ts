import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedUser } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("github-review-webhook-");
  db = await getTestDb(ctx);
  db.prepare("INSERT INTO system_settings (key, value_json) VALUES (?, ?)").run(
    "github_app_webhook_secret",
    JSON.stringify("test-webhook-secret"),
  );
});

afterEach(() => {
  ctx.cleanup();
  vi.restoreAllMocks();
});

function makeRequest(body: string, headers: Record<string, string>) {
  const requestHeaders = new Headers(headers);
  return {
    headers: requestHeaders,
    text: async () => body,
  } as any;
}

function makeJsonRequest(body: Record<string, unknown>, token: string) {
  return {
    cookies: {
      get: (name: string) => name === "session_token" ? { value: token } : undefined,
    },
    headers: new Headers(),
    json: async () => body,
  } as any;
}

function signedHeaders(body: string, eventName = "pull_request", deliveryId = "delivery-1") {
  const signature = crypto.createHmac("sha256", "test-webhook-secret").update(body).digest("hex");
  return {
    "x-github-delivery": deliveryId,
    "x-github-event": eventName,
    "x-hub-signature-256": `sha256=${signature}`,
  };
}

function reviewPayload() {
  return JSON.stringify({
    action: "review_requested",
    number: 42,
    installation: { id: 9001 },
    repository: {
      full_name: "acme/web",
      name: "web",
      owner: { login: "acme" },
    },
    pull_request: {
      number: 42,
      base: { sha: "base-sha" },
      head: { sha: "head-sha" },
      requested_reviewers: [{ login: "archie" }],
    },
  });
}

function issueCommentPayload(body: string, authorAssociation = "OWNER") {
  return {
    action: "created",
    installation: { id: 9001 },
    repository: {
      full_name: "acme/web",
      name: "web",
      owner: { login: "acme" },
    },
    issue: {
      number: 42,
      pull_request: { url: "https://api.github.com/repos/acme/web/pulls/42" },
    },
    comment: {
      id: 789,
      body,
      user: { login: "developer" },
      author_association: authorAssociation,
    },
  };
}

async function setupMappedRepository() {
  const app = seedApp(db, { name: "Web" });
  const dal = await import("@/lib/server/dal");
  dal.upsertGitHubInstallation({
    installation_id: 9001,
    account_login: "acme",
    account_type: "Organization",
  });
  dal.upsertProjectRepository({
    app_id: app.id,
    installation_id: 9001,
    owner: "acme",
    repo: "web",
  });
  return app;
}

describe("GitHub review webhook", () => {
  it("lets an admin map a GitHub installation and repository to a project", async () => {
    const app = seedApp(db, { name: "Mapped Web" });
    const admin = seedUser(db, { username: "github-review-admin" });
    const { createToken } = await import("@/lib/server/auth");
    const token = await createToken(admin.id, "GitHub Review Admin", "admin");
    const route = await import("@/app/api/github/project-repositories/route");

    const response = await route.POST(makeJsonRequest({
      app_id: app.id,
      installation_id: 9001,
      account_login: "acme",
      account_type: "Organization",
      owner: "acme",
      repo: "web",
      default_branch: "main",
    }, token));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      app_id: app.id,
      installation_id: 9001,
      owner: "acme",
      repo: "web",
    });
  });

  it("does not queue a review when a human reviewer is requested", async () => {
    await setupMappedRepository();
    const body = reviewPayload();
    const route = await import("@/app/api/github/webhooks/route");

    const response = await route.POST(makeRequest(body, signedHeaders(body)));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, status: "ignored", reason: "event_not_supported" });
    expect((db.prepare("SELECT COUNT(*) AS count FROM pull_request_reviews").get() as any).count).toBe(0);
  });

  it("deduplicates a repeated delivery without creating another review", async () => {
    await setupMappedRepository();
    const githubApp = await import("@/lib/server/github-app");
    const githubApi = await import("@/lib/server/github-review-api");
    vi.spyOn(githubApp, "getGitHubAppInstallationToken").mockResolvedValue({ token: "installation-token", expires_at: "2099-01-01T00:00:00.000Z" });
    vi.spyOn(githubApi, "getGitHubPullRequestIdentity").mockResolvedValue({ base_sha: "base-sha", head_sha: "head-sha" });
    const body = JSON.stringify(issueCommentPayload("/archie review"));
    const route = await import("@/app/api/github/webhooks/route");

    await route.POST(makeRequest(body, signedHeaders(body, "issue_comment", "delivery-command-dedup")));
    const response = await route.POST(makeRequest(body, signedHeaders(body, "issue_comment", "delivery-command-dedup")));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, duplicate: true, status: "queued", review_id: 1 });
    expect((db.prepare("SELECT COUNT(*) AS count FROM pull_request_reviews").get() as any).count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS count FROM github_webhook_events").get() as any).count).toBe(1);
  });

  it("rejects an invalid signature before persisting the event", async () => {
    await setupMappedRepository();
    const body = reviewPayload();
    const route = await import("@/app/api/github/webhooks/route");

    const response = await route.POST(makeRequest(body, {
      ...signedHeaders(body),
      "x-hub-signature-256": "sha256=invalid",
    }));
    expect(response.status).toBe(401);
    expect((db.prepare("SELECT COUNT(*) AS count FROM github_webhook_events").get() as any).count).toBe(0);
  });

  it("records an accepted but ignored event when the repository is not mapped", async () => {
    const body = JSON.stringify(issueCommentPayload("/archie review"));
    const route = await import("@/app/api/github/webhooks/route");

    const response = await route.POST(makeRequest(body, signedHeaders(body, "issue_comment", "delivery-unmapped")));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, status: "ignored", reason: "repository_not_mapped" });
    expect((db.prepare("SELECT COUNT(*) AS count FROM pull_request_reviews").get() as any).count).toBe(0);
  });

  it("records synchronization events so a later request can target the new head", async () => {
    await setupMappedRepository();
    const payload = JSON.parse(reviewPayload());
    payload.action = "synchronize";
    payload.pull_request.head.sha = "new-head-sha";
    const body = JSON.stringify(payload);
    const route = await import("@/app/api/github/webhooks/route");
    const response = await route.POST(makeRequest(body, signedHeaders(body, "pull_request", "delivery-sync")));
    expect(await response.json()).toMatchObject({ accepted: true, status: "ignored", reason: "new_head_available" });
    expect((db.prepare("SELECT head_sha FROM github_webhook_events WHERE delivery_id = ?").get("delivery-sync") as any).head_sha).toBe("new-head-sha");
  });

  it("queues a targeted review from an authorized /archie review PR comment", async () => {
    await setupMappedRepository();
    const githubApp = await import("@/lib/server/github-app");
    const githubApi = await import("@/lib/server/github-review-api");
    vi.spyOn(githubApp, "getGitHubAppInstallationToken").mockResolvedValue({ token: "installation-token", expires_at: "2099-01-01T00:00:00.000Z" });
    vi.spyOn(githubApi, "getGitHubPullRequestIdentity").mockResolvedValue({ base_sha: "base-sha", head_sha: "new-head-sha" });

    const body = JSON.stringify(issueCommentPayload("/archie review"));
    const route = await import("@/app/api/github/webhooks/route");
    const response = await route.POST(makeRequest(body, signedHeaders(body, "issue_comment", "delivery-command")));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, status: "queued", review_id: 1 });
    expect((db.prepare("SELECT * FROM pull_request_reviews").get() as any)).toMatchObject({
      action: "review_command",
      review_mode: "targeted",
      base_sha: "base-sha",
      head_sha: "new-head-sha",
      previous_review_id: null,
    });
  });

  it("stores the latest completed review as the comparison point for a full command rerun", async () => {
    await setupMappedRepository();
    const dal = await import("@/lib/server/dal");
    const previous = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "previous-review",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 9001,
      owner: "acme",
      repo: "web",
      pr_number: 42,
      base_sha: "base-sha",
      head_sha: "old-head-sha",
      requested_reviewer_login: "archie",
      payload_json: "{}",
    });
    dal.updatePullRequestReview(previous.review!.id, { status: "completed", completed_at: new Date().toISOString() });

    const githubApp = await import("@/lib/server/github-app");
    const githubApi = await import("@/lib/server/github-review-api");
    vi.spyOn(githubApp, "getGitHubAppInstallationToken").mockResolvedValue({ token: "installation-token", expires_at: "2099-01-01T00:00:00.000Z" });
    vi.spyOn(githubApi, "getGitHubPullRequestIdentity").mockResolvedValue({ base_sha: "base-sha", head_sha: "new-head-sha" });

    const body = JSON.stringify(issueCommentPayload("/archie full review"));
    const route = await import("@/app/api/github/webhooks/route");
    const response = await route.POST(makeRequest(body, signedHeaders(body, "issue_comment", "delivery-full-command")));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, status: "queued", review_id: 2 });
    expect((db.prepare("SELECT * FROM pull_request_reviews WHERE id = 2").get() as any)).toMatchObject({
      action: "review_command",
      review_mode: "full",
      previous_review_id: previous.review!.id,
      head_sha: "new-head-sha",
    });
  });

  it("ignores a review command from an unauthorized PR commenter", async () => {
    await setupMappedRepository();
    const body = JSON.stringify(issueCommentPayload("/archie review", "NONE"));
    const route = await import("@/app/api/github/webhooks/route");

    const response = await route.POST(makeRequest(body, signedHeaders(body, "issue_comment", "delivery-unauthorized-command")));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, status: "ignored", reason: "review_command_not_authorized" });
    expect((db.prepare("SELECT COUNT(*) AS count FROM pull_request_reviews").get() as any).count).toBe(0);
  });

  it("queues an explicit Archie mention only on an Archie-owned review thread", async () => {
    const app = await setupMappedRepository();
    const dal = await import("@/lib/server/dal");
    const queued = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "review-for-thread",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 9001,
      owner: "acme",
      repo: "web",
      pr_number: 42,
      base_sha: "base-sha",
      head_sha: "head-sha",
      requested_reviewer_login: "archie",
      payload_json: "{}",
    });
    dal.updatePullRequestReview(queued.review!.id, { github_review_id: 123 });
    const finding = dal.createReviewFinding({
      review_id: queued.review!.id,
      path: "src/client.ts",
      line: 12,
      title: "Original finding",
      body: "This original finding has enough detail to be stored for the thread test.",
      evidence_json: JSON.stringify({ line: 12 }),
    });
    const githubApp = await import("@/lib/server/github-app");
    const githubApi = await import("@/lib/server/github-review-api");
    vi.spyOn(githubApp, "getGitHubAppInstallationToken").mockResolvedValue({ token: "installation-token", expires_at: "2099-01-01T00:00:00.000Z" });
    vi.spyOn(githubApi, "getGitHubReviewCommentIdentity").mockResolvedValue({
      id: 12,
      pull_request_review_id: 123,
      path: "src/client.ts",
      line: 12,
      body: "**Original finding**\n\nDetails",
    });
    const body = JSON.stringify({
      action: "created",
      installation: { id: 9001 },
      repository: { full_name: "acme/web", owner: { login: "acme" }, name: "web" },
      pull_request: { number: 42, head: { sha: "head-sha" } },
      comment: {
        id: 456,
        body: "@archie can you revisit this?",
        user: { login: "developer" },
        author_association: "MEMBER",
        pull_request_review_id: 999,
        in_reply_to_id: 12,
      },
    });
    const route = await import("@/app/api/github/webhooks/route");
    const response = await route.POST(makeRequest(body, signedHeaders(body, "pull_request_review_comment", "delivery-thread")));
    expect(await response.json()).toMatchObject({ accepted: true, status: "queued" });
    expect((db.prepare("SELECT mention_text, review_id FROM review_thread_interactions").get() as any)).toMatchObject({ mention_text: "@archie can you revisit this?", review_id: queued.review!.id });
    expect(dal.listReviewFindings(queued.review!.id)[0]).toMatchObject({ id: finding.id, github_comment_id: 12 });
    expect(app.id).toBeGreaterThan(0);
  });

  it("keeps only the latest repository mapping active for a project", async () => {
    const app = seedApp(db, { name: "Remapped Web" });
    const dal = await import("@/lib/server/dal");
    dal.upsertGitHubInstallation({ installation_id: 9001, account_login: "acme" });
    dal.upsertProjectRepository({ app_id: app.id, installation_id: 9001, owner: "acme", repo: "old-web" });
    dal.upsertProjectRepository({ app_id: app.id, installation_id: 9001, owner: "acme", repo: "new-web" });

    const mappings = dal.listProjectRepositories().filter((mapping) => mapping.app_id === app.id);
    expect(mappings.filter((mapping) => mapping.state === "active")).toHaveLength(1);
    expect(mappings.find((mapping) => mapping.repo === "old-web")?.state).toBe("paused");
    expect(dal.getProjectRepositoryForApp(app.id)?.repo).toBe("new-web");
  });
});
