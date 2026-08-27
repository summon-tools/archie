import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedUser } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("review-pipeline-api-");
  db = await getTestDb(ctx);
});

afterEach(() => { ctx.cleanup(); vi.restoreAllMocks(); });

function makeRequest(url: string, options?: { body?: object; token?: string }) {
  const target = new URL(url);
  return {
    json: async () => options?.body || {},
    cookies: { get: (name: string) => name === "session_token" && options?.token ? { value: options.token } : undefined },
    headers: { get: () => null },
    nextUrl: target,
    url: target.toString(),
  } as any;
}

describe("review pipeline configuration", () => {
  it("stores a review policy and an approved OpenAPI dependency", async () => {
    const owner = seedUser(db, { name: "Admin", role: "admin" });
    const { createToken } = await import("@/lib/server/auth");
    const token = await createToken(owner.id, "Admin", "admin");
    const consumer = seedApp(db, { name: "Web" });
    const provider = seedApp(db, { name: "API" });

    const policyRoute = await import("@/app/api/apps/[appId]/review-policy/route");
    const policyResponse = await policyRoute.PUT(
      makeRequest(`http://localhost:8080/api/apps/${consumer.id}/review-policy`, {
        token,
        body: {
          revision: "2026-08-25-v1",
          priorities: ["correctness", "compatibility"],
          severity_guidance: "Advisory only",
          required_checks: ["typecheck"],
          behavior: ["No style comments"],
          tone: "Concise",
        },
      }),
      { params: Promise.resolve({ appId: String(consumer.id) }) },
    );
    expect(policyResponse.status).toBe(201);

    const dependencyRoute = await import("@/app/api/apps/[appId]/review-dependencies/route");
    const dependencyResponse = await dependencyRoute.POST(
      makeRequest(`http://localhost:8080/api/apps/${consumer.id}/review-dependencies`, {
        token,
        body: { provider_app_id: provider.id, source_path: "openapi.yaml", authoritative_ref: "main" },
      }),
      { params: Promise.resolve({ appId: String(consumer.id) }) },
    );
    expect(dependencyResponse.status).toBe(201);
    const dependency = await dependencyResponse.json();
    expect(dependency).toMatchObject({
      consumer_app_id: consumer.id,
      provider_app_id: provider.id,
      contract_type: "openapi",
      source_path: "openapi.yaml",
    });

    const dal = await import("@/lib/server/dal");
    expect(dal.getReviewPolicyForRepository(consumer.id, "acme", "web")?.revision).toBe("2026-08-25-v1");
    expect(dal.listProjectDependencies(consumer.id)).toHaveLength(1);
  });

  it("lets a project owner manage review configuration without admin access", async () => {
    const owner = seedUser(db, { username: "project-owner", name: "Project Owner", role: "member" });
    const app = seedApp(db, { name: "Owned Project" });
    db.prepare("UPDATE apps SET project_owner_user_id = ? WHERE id = ?").run(owner.id, app.id);
    const { createToken } = await import("@/lib/server/auth");
    const token = await createToken(owner.id, "Project Owner", "member");
    const policyRoute = await import("@/app/api/apps/[appId]/review-policy/route");

    const response = await policyRoute.PUT(
      makeRequest(`http://localhost:8080/api/apps/${app.id}/review-policy`, {
        token,
        body: { revision: "owner-v1", tone: "Direct" },
      }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );

    expect(response.status).toBe(201);
    expect((await response.json()).revision).toBe("owner-v1");
  });

  it("layers a repository override without archiving the project policy", async () => {
    const app = seedApp(db, { name: "Policy Layers" });
    const dal = await import("@/lib/server/dal");
    dal.createReviewPolicy({
      app_id: app.id,
      revision: "project-v1",
      policy_json: JSON.stringify({ priorities: ["correctness"], tone: "Calm" }),
    });
    dal.archiveReviewPolicies(app.id, "acme", "web");
    dal.createReviewPolicy({
      app_id: app.id,
      owner: "acme",
      repo: "web",
      revision: "repo-v1",
      policy_json: JSON.stringify({ required_checks: ["test"] }),
    });

    const layers = dal.getReviewPolicyLayers(app.id, "acme", "web");
    const { resolveReviewPolicy } = await import("@/lib/server/review-context");
    const resolved = resolveReviewPolicy(layers);
    expect(layers.company?.state).toBe("active");
    expect(resolved.revision).toBe("project-v1+repo-v1");
    expect(resolved.policy).toMatchObject({
      priorities: ["correctness"],
      required_checks: ["test"],
      tone: "Calm",
    });
  });

  it("normalizes OpenAPI authentication, response fields, and error responses", async () => {
    const { normalizeOpenApiContract } = await import("@/lib/server/review-context");
    const contract = normalizeOpenApiContract(JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Orders", version: "1" },
      security: [{ bearerAuth: [] }],
      paths: {
        "/orders": {
          post: {
            requestBody: { content: { "application/json": { schema: { properties: { sku: {}, quantity: {} } } } } },
            responses: {
              "201": { content: { "application/json": { schema: { properties: { id: {}, status: {} } } } } },
              "422": { content: { "application/json": { schema: { properties: { code: {}, message: {} } } } } },
            },
          },
        },
      },
    }), "openapi.json", "abc123");

    expect(contract.endpoints[0]).toMatchObject({
      request_fields: ["sku", "quantity"],
      response_fields: ["id", "status", "code", "message"],
      authentication_requirements: ["bearerAuth"],
      error_responses: [{ status: "422", fields: ["code", "message"] }],
    });
  });

  it("persists validated findings and review metadata", async () => {
    const app = seedApp(db, { name: "Web" });
    const dal = await import("@/lib/server/dal");
    dal.upsertGitHubInstallation({ installation_id: 7001, account_login: "acme" });
    dal.upsertProjectRepository({ app_id: app.id, installation_id: 7001, owner: "acme", repo: "web" });
    const queued = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "pipeline-finding-delivery",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 7001,
      owner: "acme",
      repo: "web",
      pr_number: 5,
      base_sha: "base",
      head_sha: "head",
      requested_reviewer_login: "archie",
      payload_json: "{}",
    });
    const finding = dal.createReviewFinding({
      review_id: queued.review!.id,
      path: "src/client.ts",
      line: 12,
      title: "Missing guard",
      body: "This changed line can throw when the response is absent; guard the value before use.",
      evidence_json: JSON.stringify({ source: "deterministic-check" }),
    });
    dal.updatePullRequestReview(queued.review!.id, {
      context_packet_json: JSON.stringify({ source: "test" }),
      publication_json: JSON.stringify({ id: 99 }),
      github_review_id: 99,
      provider_id: "mock",
      model_id: "mock-model",
      policy_revision: "default-v1",
    });
    expect(dal.listReviewFindings(queued.review!.id)[0]).toMatchObject({ id: finding.id, path: "src/client.ts", status: "proposed" });
    expect(dal.getPullRequestReviewByGitHubReviewId(99)?.id).toBe(queued.review!.id);
  });

  it("publishes one advisory native GitHub review payload", async () => {
    const { publishGitHubReview } = await import("@/lib/server/github-review-api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: 123,
      html_url: "https://github.com/acme/web/pull/5#pullrequestreview-123",
      submitted_at: "2026-08-25T00:00:00Z",
      comments: [{ id: 456, path: "src/client.ts", line: 12, html_url: "https://github.com/acme/web/pull/5#discussion_r456" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await publishGitHubReview({
      owner: "acme",
      repo: "web",
      prNumber: 5,
      commitId: "head",
      body: "Context used: github pull request.",
      comments: [{ path: "src/client.ts", line: 12, side: "RIGHT", body: "**Guard**\n\nGuard this value before use." }],
      token: "installation-token",
    });
    expect(result).toMatchObject({ id: 123, comments: [{ id: 456 }] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/web/pulls/5/reviews",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ event: "COMMENT", commit_id: "head" });
  });

  it("loads check runs from GitHub's keyed response", async () => {
    const { loadGitHubReviewContext } = await import("@/lib/server/github-review-api");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/pulls/5")) return Response.json({ number: 5, head: { sha: "head" }, base: { sha: "base" } });
      if (url.includes("/check-runs?")) return Response.json({ total_count: 1, check_runs: [{ name: "CI", status: "completed", conclusion: "success" }] });
      if (url.endsWith("/pulls/5.diff")) return new Response("", { status: 200 });
      return Response.json([]);
    });

    const context = await loadGitHubReviewContext({ owner: "acme", repo: "web", prNumber: 5, token: "installation-token" });
    expect(context.checks).toEqual([{ name: "CI", status: "completed", conclusion: "success", details_url: null, output: null }]);
    expect(context.warnings).toEqual([]);
  });

  it("uses an outdated root comment's original line for finding backfill", async () => {
    const { getGitHubReviewCommentIdentity } = await import("@/lib/server/github-review-api");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      id: 456,
      pull_request_review_id: 123,
      path: "src/client.ts",
      line: null,
      original_line: 12,
      body: "**Original finding**\n\nDetails",
    }));

    await expect(getGitHubReviewCommentIdentity({ owner: "acme", repo: "web", commentId: 456, token: "token" })).resolves.toMatchObject({
      id: 456,
      pull_request_review_id: 123,
      path: "src/client.ts",
      line: 12,
    });
  });

  it("fetches published inline comments when the review response omits them", async () => {
    const { publishGitHubReview } = await import("@/lib/server/github-review-api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (init?.method === "POST") return Response.json({ id: 123, html_url: "review-url" });
      expect(String(input)).toContain("/pulls/5/reviews/123/comments?per_page=100&page=1");
      return Response.json([{ id: 456, path: "src/client.ts", line: 12, html_url: "comment-url" }]);
    });

    const result = await publishGitHubReview({
      owner: "acme",
      repo: "web",
      prNumber: 5,
      commitId: "head",
      body: "Advisory review",
      comments: [{ path: "src/client.ts", line: 12, side: "RIGHT", body: "Guard the value." }],
      token: "installation-token",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.comments).toEqual([{ id: 456, path: "src/client.ts", line: 12, html_url: "comment-url" }]);
  });

  it("replies to the top-level review comment and updates the finding lifecycle", async () => {
    const app = seedApp(db, { name: "Thread Review" });
    const dal = await import("@/lib/server/dal");
    dal.upsertGitHubInstallation({ installation_id: 7002, account_login: "acme" });
    dal.upsertProjectRepository({ app_id: app.id, installation_id: 7002, owner: "acme", repo: "thread-review" });
    const queued = dal.queuePullRequestReviewFromWebhook({
      delivery_id: "thread-review-delivery",
      event_name: "issue_comment",
      action: "review_command",
      installation_id: 7002,
      owner: "acme",
      repo: "thread-review",
      pr_number: 6,
      base_sha: "base",
      head_sha: "head",
      requested_reviewer_login: "archie",
      payload_json: "{}",
    });
    dal.updatePullRequestReview(queued.review!.id, { github_review_id: 321, status: "completed" });
    const finding = dal.createReviewFinding({
      review_id: queued.review!.id,
      path: "src/client.ts",
      line: 12,
      title: "Missing guard",
      body: "Guard the value before use because the response may be absent.",
      evidence_json: JSON.stringify({ line: 12 }),
    });
    dal.updateReviewFinding(finding.id, { status: "published", github_comment_id: 100 });
    const interaction = dal.createReviewThreadInteraction({
      review_id: queued.review!.id,
      github_comment_id: 200,
      mention_text: "@archie fixed in the latest commit",
      raw_json: JSON.stringify({ comment: { id: 200, in_reply_to_id: 100 } }),
    });

    const githubApp = await import("@/lib/server/github-app");
    const githubApi = await import("@/lib/server/github-review-api");
    const sdkHelpers = await import("@/lib/server/sdk-helpers");
    vi.spyOn(githubApp, "getGitHubAppInstallationToken").mockResolvedValue({ token: "installation-token", expires_at: "2099-01-01T00:00:00.000Z" });
    vi.spyOn(githubApi, "loadGitHubReviewContext").mockResolvedValue({
      pull_request: {}, files: [], diff: "", checks: [], issue_comments: [], reviews: [], warnings: [],
      review_comments: [{ id: 100, body: "Original Archie finding" }],
    });
    const replySpy = vi.spyOn(githubApi, "replyToGitHubReviewComment").mockResolvedValue({ id: 201, html_url: "reply-url" });
    vi.spyOn(sdkHelpers, "runEphemeralQueryWithMetrics").mockResolvedValue({
      text: JSON.stringify({ response: "Confirmed fixed.", disposition: "resolved" }),
      sessionId: null,
      costUsd: 0.025,
      durationMs: 350,
      numTurns: 1,
      usage: { inputTokens: 120, outputTokens: 30 },
      models: ["review-model"],
    });

    const { runReviewThreadInteractionNow } = await import("@/lib/server/review-thread-jobs");
    await runReviewThreadInteractionNow(interaction.github_comment_id);

    expect(replySpy).toHaveBeenCalledWith(expect.objectContaining({ commentId: 100, body: "Confirmed fixed." }));
    const completedInteraction = db.prepare("SELECT status, disposition, model_usage_json FROM review_thread_interactions WHERE id = ?").get(interaction.id) as any;
    expect(completedInteraction).toMatchObject({ status: "completed", disposition: "resolved" });
    expect(JSON.parse(completedInteraction.model_usage_json)).toMatchObject({
      model_calls: 1,
      known_cost_usd: 0.025,
      reported_cost_usd: 0.025,
      unknown_cost_calls: 0,
      cost_source: "reported",
    });
    expect(dal.listReviewFindings(queued.review!.id)[0]).toMatchObject({ status: "fixed" });
  });
});
