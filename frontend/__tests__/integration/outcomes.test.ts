import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedConversation, seedRun, seedUser, seedWorkItem } from "../helpers/seed";
import type Database from "better-sqlite3";
import type { AppRow } from "@/lib/server/types";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("outcomes-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function loadOutcomes() {
  return await import("@/lib/server/outcomes");
}

function getAppRows(): AppRow[] {
  return db.prepare("SELECT * FROM apps ORDER BY created_at DESC, id DESC").all() as AppRow[];
}

function createWorkItem(overrides?: {
  appName?: string;
  githubRepo?: string;
  title?: string;
  status?: "proposed" | "in_progress" | "done";
  branchName?: string;
}) {
  const app = seedApp(db, { name: overrides?.appName || "Test App" });
  if (overrides?.githubRepo) {
    db.prepare("UPDATE apps SET github_repo = ? WHERE id = ?").run(overrides.githubRepo, app.id);
  }
  const conversation = seedConversation(db, app.id, { title: `${overrides?.title || "Test Work"} conversation` });
  const workItem = seedWorkItem(db, app.id, conversation.id, {
    title: overrides?.title || "Test Work",
    status: overrides?.status || "in_progress",
  });
  if (overrides?.branchName) {
    db.prepare("INSERT INTO work_item_env (work_item_id, branch_name) VALUES (?, ?)").run(workItem.id, overrides.branchName);
  }
  return { appId: app.id, conversationId: conversation.id, workItemId: workItem.id };
}

function addRun(input: {
  appId: number;
  workItemId: number;
  conversationId: number;
  status?: "running" | "completed" | "failed" | "stopped";
  provider?: string;
  model?: string;
  resultJson?: string | null;
}) {
  const run = seedRun(db, input.appId, {
    work_item_id: input.workItemId,
    conversation_id: input.conversationId,
    status: input.status || "completed",
    provider_id: input.provider || "codex",
    model_id: input.model || "gpt-5",
  });
  db.prepare("UPDATE runs SET result_json = ? WHERE id = ?").run(input.resultJson ?? null, run.id);
  return run;
}

function addPullRequestArtifact(appId: number, workItemId: number, metadata: Record<string, unknown>) {
  db.prepare("INSERT INTO artifacts (app_id, work_item_id, kind, metadata_json) VALUES (?, ?, 'pull_request', ?)")
    .run(appId, workItemId, JSON.stringify(metadata));
}

function setSetting(key: string, value: unknown) {
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value_json) VALUES (?, ?)")
    .run(key, JSON.stringify(value));
}

function makeRequest(url: string, token?: string) {
  const target = new URL(url);
  return {
    cookies: {
      get: (name: string) => {
        if (name === "session_token" && token) return { value: token };
        return undefined;
      },
    },
    headers: { get: (_name: string) => null },
    nextUrl: target,
    url: target.toString(),
  } as any;
}

function makeJsonRequest(url: string, token?: string, body: Record<string, unknown> = {}) {
  return {
    ...makeRequest(url, token),
    json: async () => body,
  } as any;
}

async function createAuthToken() {
  const user = seedUser(db, { name: "Outcome Tester", role: "admin" });
  const { createToken } = await import("@/lib/server/auth");
  return createToken(user.id, "Outcome Tester", "admin");
}

describe("outcomes summary aggregation", () => {
  it("returns an empty summary when there are no apps", async () => {
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({ apps: [] });

    expect(summary.counts.total_work_items).toBe(0);
    expect(summary.counts.total_sessions).toBe(0);
    expect(summary.rows).toEqual([]);
    expect(summary.costs.total_known_cost_usd).toBe(0);
  });

  it("returns an empty row set when accessible apps have no work items", async () => {
    seedApp(db, { name: "Empty App" });
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({ apps: getAppRows() });

    expect(summary.counts.total_work_items).toBe(0);
    expect(summary.rows).toEqual([]);
    expect(summary.filters.apps).toEqual([{ id: 1, name: "Empty App" }]);
  });

  it("adds completed run cost to the known total and no-PR bucket", async () => {
    const work = createWorkItem({ appName: "Cost App", branchName: "feature/cost" });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: 0.42 }),
    });
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({ apps: getAppRows() });

    expect(summary.counts.total_work_items).toBe(1);
    expect(summary.counts.no_pr_work).toBe(1);
    expect(summary.counts.unknown_cost_runs).toBe(0);
    expect(summary.costs.total_known_cost_usd).toBe(0.42);
    expect(summary.costs.no_pr_cost_usd).toBe(0.42);
    expect(summary.rows[0]).toMatchObject({
      app_name: "Cost App",
      branch_name: "feature/cost",
      provider_id: "codex",
      model_id: "gpt-5",
      outcome_state: "no_pr",
      known_cost_usd: 0.42,
    });
  });

  it("counts missing and malformed run cost as unknown cost evidence", async () => {
    const work = createWorkItem({ appName: "Unknown Cost App" });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: null }),
    });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: "{not-json",
    });
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({ apps: getAppRows() });

    expect(summary.counts.unknown_cost_runs).toBe(2);
    expect(summary.counts.rows_with_unknown_cost).toBe(1);
    expect(summary.costs.total_known_cost_usd).toBe(0);
    expect(summary.rows[0].known_cost_usd).toBeNull();
    expect(summary.rows[0].unknown_cost_runs).toBe(2);
  });

  it("uses local pull request artifacts for PR-linked pending rows", async () => {
    const work = createWorkItem({ appName: "PR App" });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: 1.25 }),
    });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/7",
      pr_number: 7,
    });
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({ apps: getAppRows() });

    expect(summary.counts.pr_linked_work).toBe(1);
    expect(summary.counts.pending_prs).toBe(1);
    expect(summary.costs.pending_pr_cost_usd).toBe(1.25);
    expect(summary.rows[0]).toMatchObject({
      pr_number: 7,
      pr_url: "https://github.com/acme/repo/pull/7",
      pr_state: "UNKNOWN",
      outcome_state: "pending_pr",
      evidence_completeness: "local_pr_artifact",
    });
    expect(summary.warnings).toContain("GitHub is not connected for this user, so PR states are based on local Archie evidence only.");
  });

  it("keeps GitHub enrichment failures bounded to row warnings", async () => {
    const work = createWorkItem({
      appName: "GitHub Failure App",
      githubRepo: "https://github.com/acme/repo.git",
    });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/8",
      pr_number: 8,
    });
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({
      apps: getAppRows(),
      githubToken: "token",
      prLookup: async () => {
        throw new Error("GitHub unavailable");
      },
    });

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].outcome_state).toBe("pending_pr");
    expect(summary.rows[0].warnings).toContain("GitHub PR state refresh failed.");
    expect(summary.warnings).toContain("One or more GitHub PR lookups failed; local evidence is still shown.");
  });

  it("uses GitHub enrichment to classify merged pull requests and cost buckets", async () => {
    const work = createWorkItem({ appName: "Merged App" });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: 2 }),
    });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/9",
      pr_number: 9,
    });
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({
      apps: getAppRows(),
      githubToken: "token",
      prLookup: async (params) => {
        expect(params).toMatchObject({ owner: "acme", repo: "repo", pr_number: 9 });
        return {
          state: "MERGED",
          pr_url: `https://github.com/${params.owner}/${params.repo}/pull/${params.pr_number}`,
          pr_number: params.pr_number,
          title: "Merged outcome",
        };
      },
    });

    expect(summary.counts.merged_prs).toBe(1);
    expect(summary.counts.pending_prs).toBe(0);
    expect(summary.costs.merged_pr_cost_usd).toBe(2);
    expect(summary.rows[0]).toMatchObject({
      outcome_state: "merged",
      evidence_completeness: "github_enriched",
      pr_state: "MERGED",
      pr_title: "Merged outcome",
    });
  });

  it("only aggregates work for the app rows passed in by the caller", async () => {
    const included = createWorkItem({ appName: "Included App" });
    addRun({
      appId: included.appId,
      workItemId: included.workItemId,
      conversationId: included.conversationId,
      resultJson: JSON.stringify({ cost: 0.1 }),
    });
    const excluded = createWorkItem({ appName: "Excluded App" });
    addRun({
      appId: excluded.appId,
      workItemId: excluded.workItemId,
      conversationId: excluded.conversationId,
      resultJson: JSON.stringify({ cost: 99 }),
    });
    const apps = getAppRows().filter((app) => app.id === included.appId);
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({ apps });

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].app_name).toBe("Included App");
    expect(summary.costs.total_known_cost_usd).toBe(0.1);
  });

  it("uses persisted GitHub evidence snapshots for PR outcome and evidence counts", async () => {
    const user = seedUser(db, { username: "sync-user", email: "sync@example.com" });
    const work = createWorkItem({ appName: "Synced App" });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/11",
      pr_number: 11,
    });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: 3 }),
    });
    const { runGitHubEvidenceSync } = await import("@/lib/server/outcomes-github-sync");

    const result = await runGitHubEvidenceSync({
      apps: getAppRows(),
      userId: user.id,
      githubToken: "token",
      mode: "manual",
      rangeDays: 30,
      fetchEvidence: async (params) => {
        expect(params).toMatchObject({ owner: "acme", repo: "repo", pr_number: 11 });
        return {
          pr: {
            number: 11,
            html_url: "https://github.com/acme/repo/pull/11",
            title: "Merged synced PR",
            state: "closed",
            merged_at: "2026-05-31T12:00:00Z",
            closed_at: "2026-05-31T12:00:00Z",
            created_at: "2026-05-30T12:00:00Z",
            updated_at: "2026-05-31T12:00:00Z",
            additions: 10,
            deletions: 4,
            changed_files: 2,
            commits: 1,
            user: { login: "engineer" },
            head: { ref: "feature/synced" },
            base: { ref: "main" },
          },
          issue_comments: [{ id: 101, body: "Looks good", user: { login: "reviewer" }, created_at: "2026-05-31T10:00:00Z", updated_at: "2026-05-31T10:00:00Z" }],
          review_comments: [{ id: 201, body: "Inline note", path: "app.ts", commit_id: "abc", user: { login: "reviewer" }, created_at: "2026-05-31T11:00:00Z", updated_at: "2026-05-31T11:00:00Z" }],
          reviews: [{ id: 301, state: "APPROVED", body: "Approved", user: { login: "reviewer" }, submitted_at: "2026-05-31T11:30:00Z" }],
          commits: [{
            sha: "abc",
            author: { login: "engineer" },
            committer: { login: "archie-bot" },
            commit: {
              message: "Implement synced PR",
              author: { name: "Engineer", email: "engineer@example.com", date: "2026-05-31T09:00:00Z" },
              committer: { date: "2026-05-31T09:05:00Z" },
            },
          }],
        };
      },
    });

    expect(result.run.status).toBe("completed");
    expect(result.run.scanned_count).toBe(1);
    expect(result.run.synced_count).toBe(1);
    expect(db.prepare("SELECT body FROM github_pr_comments ORDER BY github_id").all()).toEqual([
      { body: "Looks good" },
      { body: "Inline note" },
    ]);

    const { buildOutcomesSummary } = await loadOutcomes();
    const summary = await buildOutcomesSummary({ apps: getAppRows() });

    expect(summary.counts.merged_prs).toBe(1);
    expect(summary.costs.merged_pr_cost_usd).toBe(3);
    expect(summary.rows[0]).toMatchObject({
      outcome_state: "merged",
      evidence_completeness: "github_enriched",
      pr_state: "MERGED",
      pr_title: "Merged synced PR",
      github_issue_comments_count: 1,
      github_review_comments_count: 1,
      github_reviews_count: 1,
      github_commits_count: 1,
      github_additions: 10,
      github_deletions: 4,
      github_changed_files: 2,
    });
  });
});

describe("outcome snapshot recompute", () => {
  it("creates idempotent pending snapshots from local PR artifacts", async () => {
    const work = createWorkItem({ appName: "Snapshot Pending App" });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: 0.75 }),
    });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/21",
      pr_number: 21,
    });
    const { recomputeOutcomeSnapshots } = await import("@/lib/server/outcome-snapshots");

    const first = recomputeOutcomeSnapshots({ apps: getAppRows(), computedAt: "2026-05-31T12:00:00Z" });
    const second = recomputeOutcomeSnapshots({ apps: getAppRows(), computedAt: "2026-05-31T12:05:00Z" });
    const snapshots = db.prepare("SELECT * FROM llm_outcome_snapshots").all() as any[];

    expect(first.recomputed_count).toBe(1);
    expect(second.snapshots[0].id).toBe(first.snapshots[0].id);
    expect(snapshots).toHaveLength(1);
    expect(second.snapshots[0]).toMatchObject({
      outcome_state: "pending_pr",
      quality_band: "pending",
      confidence: "low",
      known_cost_usd: 0.75,
      unknown_cost_runs: 0,
    });

    const { buildOutcomesSummary } = await loadOutcomes();
    const summary = await buildOutcomesSummary({ apps: getAppRows() });
    expect(summary.rows[0]).toMatchObject({
      snapshot_id: first.snapshots[0].id,
      quality_band: "pending",
      quality_confidence: "low",
      snapshot_computed_at: "2026-05-31T12:05:00Z",
    });
  });

  it("classifies merged low-rework agent PRs as strong", async () => {
    setSetting("github_bot_username", "archie-bot");
    setSetting("github_bot_display_name", "Archie");
    setSetting("github_bot_email", "bot@example.com");
    const work = createWorkItem({ appName: "Strong App" });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/22",
      pr_number: 22,
    });
    const dal = await import("@/lib/server/dal");
    dal.replaceGitHubPrEvidence({
      snapshot: {
        app_id: work.appId,
        work_item_id: work.workItemId,
        owner: "acme",
        repo: "repo",
        pr_number: 22,
        pr_url: "https://github.com/acme/repo/pull/22",
        title: "Strong PR",
        state: "MERGED",
        commits_count: 1,
        issue_comments_count: 0,
        review_comments_count: 0,
        reviews_count: 0,
      },
      issue_comments: [],
      review_comments: [],
      reviews: [],
      commits: [{
        sha: "agent-a",
        author: { login: "archie-bot" },
        committer: { login: "archie-bot" },
        commit: {
          message: "Implement strong outcome",
          author: { name: "Archie", email: "bot@example.com", date: "2026-05-31T09:00:00Z" },
          committer: { date: "2026-05-31T09:01:00Z" },
        },
      }],
    });
    const { recomputeOutcomeSnapshots } = await import("@/lib/server/outcome-snapshots");

    const result = recomputeOutcomeSnapshots({ apps: getAppRows() });

    expect(result.snapshots[0]).toMatchObject({
      outcome_state: "merged",
      quality_band: "strong",
      confidence: "high",
      agent_commit_count: 1,
      human_commit_count: 0,
      human_after_agent_commit_count: 0,
    });
  });

  it("classifies merged PRs with human correction commits after agent work as costly rework", async () => {
    setSetting("github_bot_username", "archie-bot");
    setSetting("github_bot_display_name", "Archie");
    setSetting("github_bot_email", "bot@example.com");
    const work = createWorkItem({ appName: "Rework App" });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/23",
      pr_number: 23,
    });
    const dal = await import("@/lib/server/dal");
    dal.replaceGitHubPrEvidence({
      snapshot: {
        app_id: work.appId,
        work_item_id: work.workItemId,
        owner: "acme",
        repo: "repo",
        pr_number: 23,
        pr_url: "https://github.com/acme/repo/pull/23",
        title: "Reworked PR",
        state: "MERGED",
        commits_count: 3,
        issue_comments_count: 1,
        review_comments_count: 1,
        reviews_count: 1,
      },
      issue_comments: [{ id: 501, body: "Follow-up context", user: { login: "reviewer" } }],
      review_comments: [{ id: 601, body: "Please revise", path: "app.ts", user: { login: "reviewer" } }],
      reviews: [{ id: 701, state: "COMMENTED", body: "Needs edits", user: { login: "reviewer" } }],
      commits: [
        {
          sha: "agent-b",
          author: { login: "archie-bot" },
          committer: { login: "archie-bot" },
          commit: {
            message: "Implement initial version",
            author: { name: "Archie", email: "bot@example.com", date: "2026-05-31T09:00:00Z" },
            committer: { date: "2026-05-31T09:01:00Z" },
          },
        },
        {
          sha: "human-a",
          author: { login: "engineer" },
          committer: { login: "engineer" },
          commit: {
            message: "Fix generated behavior",
            author: { name: "Engineer", email: "engineer@example.com", date: "2026-05-31T10:00:00Z" },
            committer: { date: "2026-05-31T10:01:00Z" },
          },
        },
        {
          sha: "human-b",
          author: { login: "engineer" },
          committer: { login: "engineer" },
          commit: {
            message: "Tighten tests",
            author: { name: "Engineer", email: "engineer@example.com", date: "2026-05-31T11:00:00Z" },
            committer: { date: "2026-05-31T11:01:00Z" },
          },
        },
      ],
    });
    const { recomputeOutcomeSnapshots } = await import("@/lib/server/outcome-snapshots");

    const result = recomputeOutcomeSnapshots({ apps: getAppRows() });

    expect(result.snapshots[0]).toMatchObject({
      outcome_state: "merged",
      quality_band: "costly_reworked",
      human_commit_count: 2,
      agent_commit_count: 1,
      human_after_agent_commit_count: 2,
    });
    expect(result.snapshots[0].correction_burden_score).toBeGreaterThanOrEqual(6);
  });

  it("classifies closed unmerged pull requests as abandoned", async () => {
    const work = createWorkItem({ appName: "Abandoned App" });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/24",
      pr_number: 24,
    });
    const dal = await import("@/lib/server/dal");
    dal.replaceGitHubPrEvidence({
      snapshot: {
        app_id: work.appId,
        work_item_id: work.workItemId,
        owner: "acme",
        repo: "repo",
        pr_number: 24,
        pr_url: "https://github.com/acme/repo/pull/24",
        title: "Closed PR",
        state: "CLOSED",
        commits_count: 1,
        issue_comments_count: 0,
        review_comments_count: 0,
        reviews_count: 0,
      },
      issue_comments: [],
      review_comments: [],
      reviews: [],
      commits: [],
    });
    const { recomputeOutcomeSnapshots } = await import("@/lib/server/outcome-snapshots");

    const result = recomputeOutcomeSnapshots({ apps: getAppRows() });

    expect(result.snapshots[0]).toMatchObject({
      outcome_state: "closed_unmerged",
      quality_band: "abandoned",
      confidence: "high",
    });
  });
});

describe("GET /api/outcomes/summary", () => {
  it("requires authentication", async () => {
    const { GET } = await import("@/app/api/outcomes/summary/route");

    const response = await GET(makeRequest("http://localhost:8080/api/outcomes/summary"));

    expect(response.status).toBe(401);
  });

  it("returns an authenticated summary response", async () => {
    const token = await createAuthToken();
    const work = createWorkItem({ appName: "API App" });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: 0.33 }),
    });
    const { GET } = await import("@/app/api/outcomes/summary/route");

    const response = await GET(makeRequest("http://localhost:8080/api/outcomes/summary", token));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      counts: { total_work_items: 1, no_pr_work: 1 },
      costs: { total_known_cost_usd: 0.33, no_pr_cost_usd: 0.33 },
    });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      app_name: "API App",
      outcome_state: "no_pr",
    });
    expect(body.warnings).toEqual([]);
  });
});

describe("POST /api/outcomes/snapshots/recompute", () => {
  it("requires authentication", async () => {
    const { POST } = await import("@/app/api/outcomes/snapshots/recompute/route");

    const response = await POST(makeJsonRequest("http://localhost:8080/api/outcomes/snapshots/recompute"));

    expect(response.status).toBe(401);
  });

  it("returns recompute metadata for authenticated users", async () => {
    const token = await createAuthToken();
    const work = createWorkItem({ appName: "Snapshot API App" });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: 0.12 }),
    });
    const { POST } = await import("@/app/api/outcomes/snapshots/recompute/route");

    const response = await POST(makeJsonRequest("http://localhost:8080/api/outcomes/snapshots/recompute", token));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recomputed_count).toBe(1);
    expect(body.snapshot_ids).toHaveLength(1);
  });
});

describe("GET/PUT /api/outcomes/settings", () => {
  it("returns default settings and persists observation window updates", async () => {
    const token = await createAuthToken();
    const { GET, PUT } = await import("@/app/api/outcomes/settings/route");

    const getResponse = await GET(makeRequest("http://localhost:8080/api/outcomes/settings", token));
    await expect(getResponse.json()).resolves.toMatchObject({
      settings: {
        observation_window_days: 14,
        daily_sync_enabled: true,
        daily_sync_hour_utc: 6,
      },
    });

    const putResponse = await PUT({
      ...makeRequest("http://localhost:8080/api/outcomes/settings", token),
      json: async () => ({ observation_window_days: 30 }),
    } as any);
    await expect(putResponse.json()).resolves.toMatchObject({
      settings: {
        observation_window_days: 30,
      },
    });
  });
});
