import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedUser } from "../helpers/seed";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("reviews-overview-api-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
  vi.restoreAllMocks();
});

function makeRequest(url: string, options?: { token?: string; body?: object }) {
  const nextUrl = new URL(url);
  return {
    nextUrl,
    url: nextUrl.toString(),
    json: async () => options?.body || {},
    cookies: {
      get: (name: string) => name === "session_token" && options?.token ? { value: options.token } : undefined,
    },
    headers: { get: () => null },
  } as any;
}

function insertReview(input: {
  appId: number;
  owner?: string;
  repo: string;
  prNumber: number;
  status: "queued" | "running" | "completed" | "failed" | "not_supported";
  title?: string;
  phase?: string;
  mode?: "targeted" | "full";
  model?: string;
  baseSha?: string;
  headSha?: string;
  completedAt?: string;
  errorText?: string;
  createdAt: string;
}): number {
  const owner = input.owner || "acme";
  const result = db.prepare(
    `INSERT INTO pull_request_reviews (
       app_id, installation_id, owner, repo, pr_number, action, base_sha, head_sha, status, review_mode,
       trigger_delivery_id, pr_title, pr_url, execution_json, publication_json,
       provider_id, model_id, completed_at, error_text, created_at, updated_at
     ) VALUES (?, 9001, ?, ?, ?, 'review_command', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mock', ?, ?, ?, ?, ?)`
  ).run(
    input.appId,
    owner,
    input.repo,
    input.prNumber,
    input.baseSha || null,
    input.headSha || null,
    input.status,
    input.mode || "targeted",
    `review-overview-${crypto.randomUUID()}`,
    input.title || null,
    `https://github.com/${owner}/${input.repo}/pull/${input.prNumber}`,
    JSON.stringify({ phase: input.phase || input.status }),
    JSON.stringify(input.status === "completed" ? { html_url: `https://github.com/${owner}/${input.repo}/pull/${input.prNumber}#review` } : {}),
    input.model || null,
    input.completedAt || null,
    input.errorText || null,
    input.createdAt,
    input.completedAt || input.createdAt,
  );
  return Number(result.lastInsertRowid);
}

describe("reviews overview API", () => {
  it("lists active runs and groups terminal history by pull request", async () => {
    const user = seedUser(db, { name: "Teammate", role: "member" });
    const web = seedApp(db, { name: "Web Store" });
    const api = seedApp(db, { name: "Orders API" });
    const { createToken } = await import("@/lib/server/auth");
    const token = await createToken(user.id, "Teammate", "member");

    const waitingId = insertReview({ appId: web.id, repo: "store", prNumber: 10, status: "queued", title: "Improve checkout", createdAt: "2026-08-27 12:00:00" });
    const runningId = insertReview({ appId: api.id, repo: "orders", prNumber: 11, status: "running", title: "Validate orders", phase: "context_ready", createdAt: "2026-08-27 12:01:00" });
    const firstRunId = insertReview({ appId: web.id, repo: "store", prNumber: 20, status: "completed", title: "Add cart totals", createdAt: "2026-08-26 10:00:00", completedAt: "2026-08-26 10:02:00" });
    const latestRunId = insertReview({ appId: web.id, repo: "store", prNumber: 20, status: "completed", title: "Add cart totals", mode: "full", model: "review-model", createdAt: "2026-08-27 10:00:00", completedAt: "2026-08-27 10:03:00" });
    insertReview({ appId: api.id, repo: "orders", prNumber: 30, status: "failed", title: "Change order schema", errorText: "private local path and provider details", createdAt: "2026-08-27 11:00:00", completedAt: "2026-08-27 11:01:00" });

    const dal = await import("@/lib/server/dal");
    dal.createReviewFinding({ review_id: latestRunId, path: "cart.ts", line: 4, title: "First", body: "First finding has concrete evidence.", evidence_json: "{}" });
    dal.createReviewFinding({ review_id: latestRunId, path: "cart.ts", line: 8, title: "Second", body: "Second finding has concrete evidence.", evidence_json: "{}" });

    const route = await import("@/app/api/github/reviews/route");
    const response = await route.GET(makeRequest("http://localhost:8080/api/github/reviews", { token }));
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.active.map((review: any) => review.id)).toEqual([waitingId, runningId]);
    expect(payload.active[1]).toMatchObject({ phase: "context_ready", app_name: "Orders API" });
    expect(payload.history).toHaveLength(2);
    const cartHistory = payload.history.find((group: any) => group.latest.pr_number === 20);
    expect(cartHistory).toMatchObject({
      latest: { id: latestRunId, findings_count: 2, model_id: "review-model" },
      run_count: 2,
    });
    expect(cartHistory.runs.map((review: any) => review.id)).toEqual([latestRunId, firstRunId]);
    const failure = payload.history.find((group: any) => group.latest.pr_number === 30).latest;
    expect(failure.failure_message).toContain("could not complete");
    expect(failure).not.toHaveProperty("error_text");
    expect(payload.counts).toMatchObject({ queued: 1, running: 1, completed: 2, failed: 1 });
    expect(payload.projects).toEqual([{ id: api.id, name: "Orders API" }, { id: web.id, name: "Web Store" }]);
  });

  it("filters by project and search and paginates PR groups", async () => {
    const user = seedUser(db, { name: "Admin", role: "admin" });
    const web = seedApp(db, { name: "Web Store" });
    const api = seedApp(db, { name: "Billing API" });
    const { createToken } = await import("@/lib/server/auth");
    const token = await createToken(user.id, "Admin", "admin");
    insertReview({ appId: web.id, repo: "store", prNumber: 41, status: "completed", title: "Checkout guard", createdAt: "2026-08-27 09:00:00", completedAt: "2026-08-27 09:01:00" });
    insertReview({ appId: api.id, repo: "billing", prNumber: 42, status: "completed", title: "Invoice totals", createdAt: "2026-08-27 10:00:00", completedAt: "2026-08-27 10:01:00" });

    const route = await import("@/app/api/github/reviews/route");
    const projectResponse = await route.GET(makeRequest(`http://localhost:8080/api/github/reviews?app_id=${web.id}`, { token }));
    expect((await projectResponse.json()).history.map((group: any) => group.latest.app_id)).toEqual([web.id]);

    const searchResponse = await route.GET(makeRequest("http://localhost:8080/api/github/reviews?search=billing", { token }));
    expect((await searchResponse.json()).history[0].latest.pr_number).toBe(42);

    const pagedResponse = await route.GET(makeRequest("http://localhost:8080/api/github/reviews?page_size=1&page=1", { token }));
    const paged = await pagedResponse.json();
    expect(paged.history).toHaveLength(1);
    expect(paged.pagination).toMatchObject({ total_groups: 2, page_count: 2, has_previous: false, has_next: true });
  });

  it("requires authentication", async () => {
    const route = await import("@/app/api/github/reviews/route");
    const response = await route.GET(makeRequest("http://localhost:8080/api/github/reviews"));
    expect(response.status).toBe(401);
  });

  it("keeps manual reruns admin-only", async () => {
    const admin = seedUser(db, { username: "admin", name: "Admin", role: "admin" });
    const member = seedUser(db, { username: "member", name: "Member", role: "member", email: "member@example.com" });
    const app = seedApp(db, { name: "Web Store" });
    const reviewId = insertReview({
      appId: app.id,
      repo: "store",
      prNumber: 50,
      status: "completed",
      title: "Ready to rerun",
      baseSha: "historical-base",
      headSha: "historical-head",
      createdAt: "2026-08-27 08:00:00",
      completedAt: "2026-08-27 08:01:00",
    });
    const { createToken } = await import("@/lib/server/auth");
    const memberToken = await createToken(member.id, "Member", "member");
    const adminToken = await createToken(admin.id, "Admin", "admin");
    const githubApp = await import("@/lib/server/github-app");
    const githubApi = await import("@/lib/server/github-review-api");
    vi.spyOn(githubApp, "getGitHubAppInstallationToken").mockResolvedValue({
      token: "installation-token",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    vi.spyOn(githubApi, "getGitHubPullRequestIdentity").mockResolvedValue({
      base_sha: "current-base",
      head_sha: "current-head",
    });
    const route = await import("@/app/api/github/reviews/[reviewId]/rerun/route");

    const forbidden = await route.POST(
      makeRequest(`http://localhost:8080/api/github/reviews/${reviewId}/rerun`, { token: memberToken, body: { mode: "full" } }),
      { params: Promise.resolve({ reviewId: String(reviewId) }) },
    );
    expect(forbidden.status).toBe(403);

    const accepted = await route.POST(
      makeRequest(`http://localhost:8080/api/github/reviews/${reviewId}/rerun`, { token: adminToken, body: { mode: "full" } }),
      { params: Promise.resolve({ reviewId: String(reviewId) }) },
    );
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({
      status: "queued",
      review_mode: "full",
      previous_review_id: reviewId,
      base_sha: "current-base",
      head_sha: "current-head",
    });
  });
});
