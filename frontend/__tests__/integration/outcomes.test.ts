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

  it("paginates filtered rows while preserving global summary totals", async () => {
    const first = createWorkItem({ appName: "Pagination App", title: "First Codex Work" });
    addRun({
      appId: first.appId,
      workItemId: first.workItemId,
      conversationId: first.conversationId,
      provider: "codex",
      resultJson: JSON.stringify({ cost: 1 }),
    });
    const otherProvider = createWorkItem({ appName: "Pagination App", title: "Anthropic Work" });
    addRun({
      appId: otherProvider.appId,
      workItemId: otherProvider.workItemId,
      conversationId: otherProvider.conversationId,
      provider: "claude",
      resultJson: JSON.stringify({ cost: 2 }),
    });
    const latest = createWorkItem({ appName: "Pagination App", title: "Latest Codex Work" });
    addRun({
      appId: latest.appId,
      workItemId: latest.workItemId,
      conversationId: latest.conversationId,
      provider: "codex",
      resultJson: JSON.stringify({ cost: 3 }),
    });
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({
      apps: getAppRows(),
      refreshGitHubState: false,
      rowFilters: { providerId: "codex" },
      pagination: { page: 2, pageSize: 1 },
    });

    expect(summary.counts.total_work_items).toBe(3);
    expect(summary.costs.total_known_cost_usd).toBe(6);
    expect(summary.pagination).toMatchObject({
      page: 2,
      page_size: 1,
      total_rows: 3,
      filtered_rows: 2,
      page_count: 2,
      has_previous: true,
      has_next: false,
    });
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      work_item_title: "First Codex Work",
      provider_id: "codex",
    });
    expect(summary.filters.providers).toEqual(["claude", "codex"]);
  });

  it("paginates each outcome group independently", async () => {
    const firstNoPr = createWorkItem({ appName: "Grouped Pagination App", title: "First No PR" });
    addRun({
      appId: firstNoPr.appId,
      workItemId: firstNoPr.workItemId,
      conversationId: firstNoPr.conversationId,
      resultJson: JSON.stringify({ cost: 1 }),
    });
    const latestNoPr = createWorkItem({ appName: "Grouped Pagination App", title: "Latest No PR" });
    addRun({
      appId: latestNoPr.appId,
      workItemId: latestNoPr.workItemId,
      conversationId: latestNoPr.conversationId,
      resultJson: JSON.stringify({ cost: 2 }),
    });
    const firstPending = createWorkItem({ appName: "Grouped Pagination App", title: "First Pending" });
    addPullRequestArtifact(firstPending.appId, firstPending.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/41",
      pr_number: 41,
    });
    const latestPending = createWorkItem({ appName: "Grouped Pagination App", title: "Latest Pending" });
    addPullRequestArtifact(latestPending.appId, latestPending.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/42",
      pr_number: 42,
    });
    const { buildOutcomesSummary } = await loadOutcomes();

    const summary = await buildOutcomesSummary({
      apps: getAppRows(),
      refreshGitHubState: false,
      groupPagination: {
        pageSize: 1,
        pagesByState: {
          pending_pr: 2,
          no_pr: 1,
        },
      },
    });

    const pendingGroup = summary.row_groups.find((group) => group.state === "pending_pr");
    const noPrGroup = summary.row_groups.find((group) => group.state === "no_pr");
    expect(pendingGroup?.pagination).toMatchObject({
      page: 2,
      page_size: 1,
      total_rows: 2,
      filtered_rows: 2,
      page_count: 2,
    });
    expect(pendingGroup?.rows).toHaveLength(1);
    expect(pendingGroup?.rows[0].work_item_title).toBe("First Pending");
    expect(noPrGroup?.pagination).toMatchObject({
      page: 1,
      page_size: 1,
      total_rows: 2,
      filtered_rows: 2,
      page_count: 2,
    });
    expect(noPrGroup?.rows).toHaveLength(1);
    expect(noPrGroup?.rows[0].work_item_title).toBe("Latest No PR");
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

  it("syncs all PR candidates in range when no explicit sync limit is provided", async () => {
    const user = seedUser(db, { username: "sync-all-user", email: "sync-all@example.com" });
    const works = [1, 2, 3].map((index) => {
      const work = createWorkItem({ appName: "Sync All App", title: `Sync All Work ${index}` });
      addPullRequestArtifact(work.appId, work.workItemId, {
        pr_url: `https://github.com/acme/repo/pull/${50 + index}`,
        pr_number: 50 + index,
      });
      return work;
    });
    const { runGitHubEvidenceSync } = await import("@/lib/server/outcomes-github-sync");

    const result = await runGitHubEvidenceSync({
      apps: getAppRows(),
      userId: user.id,
      githubToken: "token",
      mode: "manual",
      fetchEvidence: async (params) => ({
        pr: {
          number: params.pr_number,
          html_url: `https://github.com/acme/repo/pull/${params.pr_number}`,
          title: `Synced PR ${params.pr_number}`,
          state: "open",
          merged_at: null,
          closed_at: null,
          created_at: "2026-05-30T12:00:00Z",
          updated_at: "2026-05-31T12:00:00Z",
          additions: 1,
          deletions: 0,
          changed_files: 1,
          commits: 1,
          user: { login: "archie-bot" },
          head: { ref: "feature/sync-all" },
          base: { ref: "main" },
        },
        issue_comments: [],
        review_comments: [],
        reviews: [],
        commits: [],
      }),
    });

    expect(result.run.status).toBe("completed");
    expect(result.run.scanned_count).toBe(works.length);
    expect(result.run.synced_count).toBe(works.length);
    expect(db.prepare("SELECT COUNT(*) AS count FROM github_pr_snapshots").get()).toEqual({ count: works.length });
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
      pr_author_classification: "unknown",
      attribution_confidence: "low",
      snapshot_computed_at: "2026-05-31T12:05:00Z",
    });
    expect(summary.rows[0].snapshot_evidence).toMatchObject({
      quality_reason: "A local pull request artifact exists, but GitHub evidence has not been synced.",
      pr_author: { classification: "unknown", confidence: "low" },
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
        author_login: "archie-bot",
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
      pr_author_login: "archie-bot",
      pr_author_classification: "agent",
      pr_author_confidence: "high",
      attribution_confidence: "high",
      agent_commit_count: 1,
      human_commit_count: 0,
      human_after_agent_commit_count: 0,
    });
    const evidence = JSON.parse(result.snapshots[0].evidence_json || "{}");
    expect(evidence).toMatchObject({
      pr_author: { login: "archie-bot", classification: "agent", confidence: "high" },
    });
    expect(evidence.quality_reason).toContain("merged with low review pressure");
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

  it("classifies PR authors matched to connected GitHub users", async () => {
    const user = seedUser(db, { username: "connected-engineer", email: "engineer@example.com" });
    db.prepare(
      `INSERT INTO github_user_connections (
        user_id, github_user_id, github_login, github_name, github_email, access_token_ciphertext
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(user.id, 123, "engineer", "Engineer", "engineer@example.com", "ciphertext");
    const work = createWorkItem({ appName: "Known User App" });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/25",
      pr_number: 25,
    });
    const dal = await import("@/lib/server/dal");
    dal.replaceGitHubPrEvidence({
      snapshot: {
        app_id: work.appId,
        work_item_id: work.workItemId,
        owner: "acme",
        repo: "repo",
        pr_number: 25,
        pr_url: "https://github.com/acme/repo/pull/25",
        title: "Known user PR",
        state: "OPEN",
        author_login: "engineer",
        commits_count: 0,
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
      outcome_state: "pending_pr",
      pr_author_login: "engineer",
      pr_author_classification: "known_user",
      pr_author_confidence: "high",
      attribution_confidence: "high",
    });
  });

  it("limits recompute to work items inside the selected date range", async () => {
    const recent = createWorkItem({ appName: "Recent Range App", title: "Recent Work" });
    const old = createWorkItem({ appName: "Old Range App", title: "Old Work" });
    db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").run("2026-05-20 10:00:00", recent.workItemId);
    db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").run("2026-04-01 10:00:00", old.workItemId);
    const { recomputeOutcomeSnapshots } = await import("@/lib/server/outcome-snapshots");

    const result = recomputeOutcomeSnapshots({
      apps: getAppRows(),
      rangeStart: "2026-05-01 00:00:00",
      rangeEnd: "2026-05-31 23:59:59",
    });

    expect(result.recomputed_count).toBe(1);
    expect(result.snapshots[0].work_item_id).toBe(recent.workItemId);
    expect(db.prepare("SELECT work_item_id FROM llm_outcome_snapshots").all()).toEqual([
      { work_item_id: recent.workItemId },
    ]);
  });
});

describe("outcome evidence assessment", () => {
  it("assesses every matching GitHub snapshot by default instead of capping the batch", async () => {
    const dal = await import("@/lib/server/dal");
    for (let index = 1; index <= 26; index += 1) {
      const work = createWorkItem({ appName: `Assessment Batch App ${index}` });
      const prNumber = 1000 + index;
      addPullRequestArtifact(work.appId, work.workItemId, {
        pr_url: `https://github.com/acme/repo/pull/${prNumber}`,
        pr_number: prNumber,
      });
      dal.replaceGitHubPrEvidence({
        snapshot: {
          app_id: work.appId,
          work_item_id: work.workItemId,
          owner: "acme",
          repo: "repo",
          pr_number: prNumber,
          pr_url: `https://github.com/acme/repo/pull/${prNumber}`,
          title: `Assessment Batch PR ${index}`,
          state: "MERGED",
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
    }

    const { runOutcomeEvidenceAssessment } = await import("@/lib/server/outcome-assessments");
    let assessmentCalls = 0;
    const result = await runOutcomeEvidenceAssessment({
      apps: getAppRows(),
      assessor: async () => {
        assessmentCalls += 1;
        return {
          review_pressure: "low",
          comment_categories: {
            clarification: 0,
            requested_change: 0,
            bug_or_regression: 0,
            nit: 0,
            approval_or_positive: 0,
            other: 0,
          },
          human_followup_type: "none",
          agent_correction_commit_count: 0,
          confidence: "high",
          evidence_ids: [],
          summary: "No correction evidence found.",
        };
      },
    });

    expect(assessmentCalls).toBe(26);
    expect(result.assessed_count).toBe(26);
    expect(result.failed_count).toBe(0);
  });

  it("can downgrade deterministic rework when review evidence is clarification and expected iteration", async () => {
    setSetting("github_bot_username", "archie-bot");
    setSetting("github_bot_display_name", "Archie");
    setSetting("github_bot_email", "bot@example.com");
    const work = createWorkItem({ appName: "Clarification App" });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/31",
      pr_number: 31,
    });
    const dal = await import("@/lib/server/dal");
    dal.replaceGitHubPrEvidence({
      snapshot: {
        app_id: work.appId,
        work_item_id: work.workItemId,
        owner: "acme",
        repo: "repo",
        pr_number: 31,
        pr_url: "https://github.com/acme/repo/pull/31",
        title: "Clarification PR",
        state: "MERGED",
        commits_count: 3,
        issue_comments_count: 1,
        review_comments_count: 5,
        reviews_count: 1,
      },
      issue_comments: [{ id: 901, body: "Can you explain the migration path?", user: { login: "reviewer" } }],
      review_comments: [1, 2, 3, 4, 5].map((index) => ({
        id: 910 + index,
        body: `Question ${index}: can you explain why this branch handles the fallback?`,
        path: "app.ts",
        user: { login: "reviewer" },
      })),
      reviews: [{ id: 930, state: "COMMENTED", body: "Mostly questions before approval.", user: { login: "reviewer" } }],
      commits: [
        {
          sha: "agent-clarify",
          author: { login: "archie-bot" },
          committer: { login: "archie-bot" },
          commit: {
            message: "Implement initial fallback",
            author: { name: "Archie", email: "bot@example.com", date: "2026-05-31T09:00:00Z" },
            committer: { date: "2026-05-31T09:01:00Z" },
          },
        },
        {
          sha: "human-context-a",
          author: { login: "engineer" },
          committer: { login: "engineer" },
          commit: {
            message: "Add explanation comments",
            author: { name: "Engineer", email: "engineer@example.com", date: "2026-05-31T10:00:00Z" },
            committer: { date: "2026-05-31T10:01:00Z" },
          },
        },
        {
          sha: "human-context-b",
          author: { login: "engineer" },
          committer: { login: "engineer" },
          commit: {
            message: "Clarify test naming",
            author: { name: "Engineer", email: "engineer@example.com", date: "2026-05-31T11:00:00Z" },
            committer: { date: "2026-05-31T11:01:00Z" },
          },
        },
      ],
    });
    const { runOutcomeEvidenceAssessment } = await import("@/lib/server/outcome-assessments");

    const result = await runOutcomeEvidenceAssessment({
      apps: getAppRows(),
      assessor: async (packet) => {
        expect(packet.comments.length).toBe(6);
        return {
          review_pressure: "medium",
          comment_categories: {
            clarification: 6,
            requested_change: 0,
            bug_or_regression: 0,
            nit: 0,
            approval_or_positive: 0,
            other: 0,
          },
          human_followup_type: "expected_iteration",
          agent_correction_commit_count: 0,
          confidence: "high",
          evidence_ids: ["issue-901", "review-911", "commit-human-context-a"],
          summary: "Review traffic was clarification-oriented, not correction work.",
        };
      },
    });

    expect(result.assessed_count).toBe(1);
    expect(result.failed_count).toBe(0);
    const snapshot = db.prepare("SELECT * FROM llm_outcome_snapshots WHERE work_item_id = ?").get(work.workItemId) as any;
    expect(snapshot.quality_band).toBe("useful");
    const evidence = JSON.parse(snapshot.evidence_json || "{}");
    expect(evidence.deterministic_quality_band).toBe("costly_reworked");
    expect(evidence.llm_assessment).toMatchObject({
      human_followup_type: "expected_iteration",
      confidence: "high",
    });
    expect(evidence.quality_reason).toContain("classified them as clarification");
  });

  it("can upgrade moderate deterministic evidence to costly rework when assessment finds agent correction", async () => {
    setSetting("github_bot_username", "archie-bot");
    setSetting("github_bot_display_name", "Archie");
    setSetting("github_bot_email", "bot@example.com");
    const work = createWorkItem({ appName: "Correction App" });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/32",
      pr_number: 32,
    });
    const dal = await import("@/lib/server/dal");
    dal.replaceGitHubPrEvidence({
      snapshot: {
        app_id: work.appId,
        work_item_id: work.workItemId,
        owner: "acme",
        repo: "repo",
        pr_number: 32,
        pr_url: "https://github.com/acme/repo/pull/32",
        title: "Correction PR",
        state: "MERGED",
        commits_count: 2,
        issue_comments_count: 0,
        review_comments_count: 1,
        reviews_count: 1,
      },
      issue_comments: [],
      review_comments: [{ id: 1001, body: "This breaks checkout totals; please fix the generated branch.", path: "checkout.ts", user: { login: "reviewer" } }],
      reviews: [{ id: 1002, state: "COMMENTED", body: "Needs fix before merge.", user: { login: "reviewer" } }],
      commits: [
        {
          sha: "agent-correction",
          author: { login: "archie-bot" },
          committer: { login: "archie-bot" },
          commit: {
            message: "Implement checkout totals",
            author: { name: "Archie", email: "bot@example.com", date: "2026-05-31T09:00:00Z" },
            committer: { date: "2026-05-31T09:01:00Z" },
          },
        },
        {
          sha: "human-correction",
          author: { login: "engineer" },
          committer: { login: "engineer" },
          commit: {
            message: "Fix checkout totals from generated implementation",
            author: { name: "Engineer", email: "engineer@example.com", date: "2026-05-31T10:00:00Z" },
            committer: { date: "2026-05-31T10:01:00Z" },
          },
        },
      ],
    });
    const { runOutcomeEvidenceAssessment } = await import("@/lib/server/outcome-assessments");

    const result = await runOutcomeEvidenceAssessment({
      apps: getAppRows(),
      assessor: async () => ({
        review_pressure: "high",
        comment_categories: {
          clarification: 0,
          requested_change: 1,
          bug_or_regression: 1,
          nit: 0,
          approval_or_positive: 0,
          other: 0,
        },
        human_followup_type: "agent_correction",
        agent_correction_commit_count: 1,
        confidence: "high",
        evidence_ids: ["review-1001", "commit-human-correction"],
        summary: "Reviewer and follow-up commit point to correcting generated behavior.",
      }),
    });

    expect(result.assessed_count).toBe(1);
    const snapshot = db.prepare("SELECT * FROM llm_outcome_snapshots WHERE work_item_id = ?").get(work.workItemId) as any;
    expect(snapshot.quality_band).toBe("costly_reworked");
    const evidence = JSON.parse(snapshot.evidence_json || "{}");
    expect(evidence.deterministic_quality_band).toBe("useful");
    expect(evidence.llm_assessment).toMatchObject({
      human_followup_type: "agent_correction",
      agent_correction_commit_count: 1,
    });
  });
});

describe("outcome learning reports", () => {
  it("generates a persisted report from resolved PR evidence and excludes pending work from conclusions", async () => {
    setSetting("github_bot_username", "archie-bot");
    setSetting("github_bot_display_name", "Archie");
    setSetting("github_bot_email", "bot@example.com");
    const resolved = createWorkItem({ appName: "Report App", title: "Resolved Report Work" });
    db.prepare("INSERT INTO messages (conversation_id, seq, role, kind, body_md) VALUES (?, 1, 'user', 'text', ?)")
      .run(resolved.conversationId, "Build a focused billing export with tests and keep the UI unchanged.");
    addRun({
      appId: resolved.appId,
      workItemId: resolved.workItemId,
      conversationId: resolved.conversationId,
      resultJson: JSON.stringify({ cost: 0.5 }),
    });
    addPullRequestArtifact(resolved.appId, resolved.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/41",
      pr_number: 41,
    });
    const pending = createWorkItem({ appName: "Report App", title: "Pending Report Work" });
    addPullRequestArtifact(pending.appId, pending.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/42",
      pr_number: 42,
    });
    const dal = await import("@/lib/server/dal");
    dal.replaceGitHubPrEvidence({
      snapshot: {
        app_id: resolved.appId,
        work_item_id: resolved.workItemId,
        owner: "acme",
        repo: "repo",
        pr_number: 41,
        pr_url: "https://github.com/acme/repo/pull/41",
        title: "Resolved report PR",
        state: "MERGED",
        author_login: "archie-bot",
        commits_count: 1,
        issue_comments_count: 0,
        review_comments_count: 0,
        reviews_count: 0,
      },
      issue_comments: [],
      review_comments: [],
      reviews: [],
      commits: [{
        sha: "report-agent",
        author: { login: "archie-bot" },
        committer: { login: "archie-bot" },
        commit: {
          message: "Implement billing export",
          author: { name: "Archie", email: "bot@example.com", date: "2026-05-31T09:00:00Z" },
          committer: { date: "2026-05-31T09:01:00Z" },
        },
      }],
    });
    dal.replaceGitHubPrEvidence({
      snapshot: {
        app_id: pending.appId,
        work_item_id: pending.workItemId,
        owner: "acme",
        repo: "repo",
        pr_number: 42,
        pr_url: "https://github.com/acme/repo/pull/42",
        title: "Pending report PR",
        state: "OPEN",
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
    db.prepare("UPDATE work_items SET updated_at = ? WHERE id IN (?, ?)")
      .run("2026-05-31 12:00:00", resolved.workItemId, pending.workItemId);
    const { runOutcomeLearningReport } = await import("@/lib/server/outcome-reports");

    const report = await runOutcomeLearningReport({
      apps: getAppRows(),
      rangeStart: "2026-05-01T00:00:00Z",
      rangeEnd: "2026-06-02T00:00:00Z",
      generatedAt: "2026-06-01T12:00:00Z",
      userId: null,
    });

    expect(report.status).toBe("completed");
    expect(report.report).toMatchObject({
      version: 2,
      counts: {
        total_work_items: 2,
        resolved_prs: 1,
        merged_prs: 1,
        pending_prs_excluded: 1,
      },
      costs: {
        resolved_known_cost_usd: 0.5,
        strong_known_cost_usd: 0.5,
        likely_regression_known_cost_usd: 0,
      },
    });
    expect(report.report?.insights[0]).toMatchObject({
      id: "strong_outcomes",
      summary: expect.stringContaining("asked for tests"),
      evidence: [{
        work_item_id: resolved.workItemId,
        prompt_excerpt: "Build a focused billing export with tests and keep the UI unchanged.",
      }],
    });
    expect(report.report?.recommendations[0]).toMatchObject({
      id: "create_team_skill_from_strong_examples",
      action: expect.stringContaining("Draft a Codex/Archie skill"),
    });
    const stored = db.prepare("SELECT * FROM llm_outcome_reports").all() as any[];
    expect(stored).toHaveLength(1);
    expect(JSON.parse(stored[0].report_json).counts.resolved_prs).toBe(1);
  });

  it("includes every resolved row in the report instead of only the first dashboard page", async () => {
    setSetting("github_bot_username", "archie-bot");
    for (let index = 1; index <= 26; index += 1) {
      const work = createWorkItem({ appName: `Full Report App ${index}`, title: `Merged Report Work ${index}` });
      addRun({
        appId: work.appId,
        workItemId: work.workItemId,
        conversationId: work.conversationId,
        resultJson: JSON.stringify({ cost: 0.1 }),
      });
      addPullRequestArtifact(work.appId, work.workItemId, {
        pr_url: `https://github.com/acme/repo/pull/${700 + index}`,
        pr_number: 700 + index,
      });
      const dal = await import("@/lib/server/dal");
      dal.replaceGitHubPrEvidence({
        snapshot: {
          app_id: work.appId,
          work_item_id: work.workItemId,
          owner: "acme",
          repo: "repo",
          pr_number: 700 + index,
          pr_url: `https://github.com/acme/repo/pull/${700 + index}`,
          title: `Merged report PR ${index}`,
          state: "MERGED",
          author_login: "archie-bot",
          commits_count: 1,
          issue_comments_count: 0,
          review_comments_count: 0,
          reviews_count: 0,
        },
        issue_comments: [],
        review_comments: [],
        reviews: [],
        commits: [{
          sha: `full-report-${index}`,
          author: { login: "archie-bot" },
          committer: { login: "archie-bot" },
          commit: {
            message: `Implement report work ${index}`,
            author: { name: "Archie", email: "bot@example.com", date: "2026-05-31T09:00:00Z" },
            committer: { date: "2026-05-31T09:01:00Z" },
          },
        }],
      });
      db.prepare("UPDATE work_items SET updated_at = ? WHERE id = ?").run("2026-05-31 12:00:00", work.workItemId);
    }
    const { runOutcomeLearningReport } = await import("@/lib/server/outcome-reports");

    const report = await runOutcomeLearningReport({
      apps: getAppRows(),
      rangeStart: "2026-05-01T00:00:00Z",
      rangeEnd: "2026-06-02T00:00:00Z",
      generatedAt: "2026-06-01T12:00:00Z",
      userId: null,
    });

    expect(report.status).toBe("completed");
    expect(report.report?.counts.resolved_prs).toBe(26);
    expect(report.report?.counts.merged_prs).toBe(26);
    expect(report.report?.costs.resolved_known_cost_usd).toBeCloseTo(2.6);
  });
});

describe("outcome follow-up detection", () => {
  it("links later PRs that likely fix regressions from merged Archie PRs", async () => {
    setSetting("github_bot_username", "archie-bot");
    setSetting("github_bot_display_name", "Archie");
    setSetting("github_bot_email", "bot@example.com");
    const work = createWorkItem({ appName: "Follow-up App", title: "Checkout totals" });
    addPullRequestArtifact(work.appId, work.workItemId, {
      pr_url: "https://github.com/acme/repo/pull/51",
      pr_number: 51,
    });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: 0.7 }),
    });
    const dal = await import("@/lib/server/dal");
    dal.replaceGitHubPrEvidence({
      snapshot: {
        app_id: work.appId,
        work_item_id: work.workItemId,
        owner: "acme",
        repo: "repo",
        pr_number: 51,
        pr_url: "https://github.com/acme/repo/pull/51",
        title: "Add checkout totals",
        state: "MERGED",
        author_login: "archie-bot",
        merged_at: "2026-05-20T12:00:00Z",
        github_created_at: "2026-05-20T10:00:00Z",
        github_updated_at: "2026-05-20T12:00:00Z",
        commits_count: 1,
        issue_comments_count: 0,
        review_comments_count: 0,
        reviews_count: 0,
        raw_json: JSON.stringify({ body: "Implements checkout totals." }),
      },
      issue_comments: [],
      review_comments: [],
      reviews: [],
      commits: [{
        sha: "checkout-source",
        author: { login: "archie-bot" },
        committer: { login: "archie-bot" },
        commit: {
          message: "Add checkout totals",
          author: { name: "Archie", email: "bot@example.com", date: "2026-05-20T10:00:00Z" },
          committer: { date: "2026-05-20T10:01:00Z" },
        },
      }],
    });
    const { recomputeOutcomeSnapshots } = await import("@/lib/server/outcome-snapshots");
    recomputeOutcomeSnapshots({ apps: getAppRows() });
    const { runOutcomeFollowupDetection } = await import("@/lib/server/outcome-followups");

    const result = await runOutcomeFollowupDetection({
      apps: getAppRows(),
      githubToken: "token",
      rangeStart: "2026-05-01T00:00:00Z",
      rangeEnd: "2026-06-01T00:00:00Z",
      observationDays: 14,
      fetchRepositoryPullRequests: async () => [
        {
          number: 51,
          html_url: "https://github.com/acme/repo/pull/51",
          title: "Add checkout totals",
          body: "Implements checkout totals.",
          state: "closed",
          merged_at: "2026-05-20T12:00:00Z",
          created_at: "2026-05-20T10:00:00Z",
          updated_at: "2026-05-20T12:00:00Z",
          user: { login: "archie-bot" },
          head: { ref: "feature/checkout" },
          base: { ref: "main" },
        },
        {
          number: 52,
          html_url: "https://github.com/acme/repo/pull/52",
          title: "Fix regression in checkout totals",
          body: "Fixes #51 where checkout totals broke discounts.",
          state: "closed",
          merged_at: "2026-05-22T12:00:00Z",
          created_at: "2026-05-22T10:00:00Z",
          updated_at: "2026-05-22T12:00:00Z",
          user: { login: "engineer" },
          head: { ref: "fix/checkout-totals" },
          base: { ref: "main" },
        },
      ],
      fetchPullRequestFiles: async ({ pr_number }) => [
        { filename: pr_number === 51 ? "src/checkout.ts" : "src/checkout.ts", status: "modified", additions: 3, deletions: 1, changes: 4 },
      ],
      verifier: async (packet) => {
        expect(packet.source.pr_number).toBe(51);
        expect(packet.followup.pr_number).toBe(52);
        expect(packet.deterministic.signals).toContain("references_source_pr");
        return {
          relation_type: "regression_fix",
          confidence: "high",
          evidence_ids: ["references_source_pr", "file_overlap:1"],
          summary: "The later PR explicitly fixes a regression from the source PR.",
        };
      },
    });

    expect(result).toMatchObject({
      scanned_source_prs: 1,
      candidate_count: 1,
      detected_count: 1,
      regression_count: 1,
    });
    const { buildOutcomesSummary } = await loadOutcomes();
    const summary = await buildOutcomesSummary({ apps: getAppRows() });
    expect(summary.rows[0]).toMatchObject({
      followup_count: 1,
      regression_followup_count: 1,
    });
    expect(summary.rows[0].followup_evidence[0]).toMatchObject({
      relation_type: "regression_fix",
      confidence: "high",
      followup_pr_number: 52,
      summary: "The later PR explicitly fixes a regression from the source PR.",
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
    const noPrGroup = body.row_groups.find((group: any) => group.state === "no_pr");
    expect(noPrGroup).toMatchObject({
      pagination: {
        page: 1,
        filtered_rows: 1,
      },
    });
    expect(noPrGroup.rows).toHaveLength(1);
    expect(body.warnings).toEqual([]);
  });
});

describe("POST /api/outcomes/snapshots/recompute", () => {
  it("requires authentication", async () => {
    const { POST } = await import("@/app/api/outcomes/snapshots/recompute/route");

    const response = await POST(makeJsonRequest("http://localhost:8080/api/outcomes/snapshots/recompute"));

    expect(response.status).toBe(401);
  });

  it("queues recompute work and stores result metadata when the job runs", async () => {
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

    expect(response.status).toBe(202);
    expect(body.job).toMatchObject({
      kind: "snapshot_recompute",
      status: "queued",
    });

    const { runOutcomeJobNow } = await import("@/lib/server/outcome-jobs");
    const completed = await runOutcomeJobNow(body.job.id);
    const result = JSON.parse(completed.result_json || "{}");
    expect(completed.status).toBe("completed");
    expect(result.recomputed_count).toBe(1);
    expect(result.snapshot_ids).toHaveLength(1);
  });
});

describe("POST /api/outcomes/assessments/run", () => {
  it("requires authentication", async () => {
    const { POST } = await import("@/app/api/outcomes/assessments/run/route");

    const response = await POST(makeJsonRequest("http://localhost:8080/api/outcomes/assessments/run"));

    expect(response.status).toBe(401);
  });

  it("queues assessment work and stores result metadata when the job runs", async () => {
    const token = await createAuthToken();
    const { POST } = await import("@/app/api/outcomes/assessments/run/route");

    const response = await POST(makeJsonRequest("http://localhost:8080/api/outcomes/assessments/run", token, { range_days: 14 }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.job).toMatchObject({
      kind: "evidence_assessment",
      status: "queued",
    });
    expect(JSON.parse(body.job.input_json)).not.toHaveProperty("maxItems");

    const { runOutcomeJobNow } = await import("@/lib/server/outcome-jobs");
    const completed = await runOutcomeJobNow(body.job.id);
    const result = JSON.parse(completed.result_json || "{}");
    expect(completed.status).toBe("completed");
    expect(result).toMatchObject({
      assessed_count: 0,
      skipped_count: 0,
      failed_count: 0,
      assessment_ids: [],
      recomputed_snapshots: 0,
    });
  });
});

describe("outcome report APIs", () => {
  it("requires authentication for latest reports", async () => {
    const { GET } = await import("@/app/api/outcomes/reports/latest/route");

    const response = await GET(makeRequest("http://localhost:8080/api/outcomes/reports/latest"));

    expect(response.status).toBe(401);
  });

  it("requires authentication for report generation", async () => {
    const { POST } = await import("@/app/api/outcomes/reports/run/route");

    const response = await POST(makeJsonRequest("http://localhost:8080/api/outcomes/reports/run"));

    expect(response.status).toBe(401);
  });

  it("queues report generation and exposes the latest report after the job runs", async () => {
    const token = await createAuthToken();
    const work = createWorkItem({ appName: "Report API App" });
    addRun({
      appId: work.appId,
      workItemId: work.workItemId,
      conversationId: work.conversationId,
      resultJson: JSON.stringify({ cost: 0.2 }),
    });
    const { POST } = await import("@/app/api/outcomes/reports/run/route");
    const { GET } = await import("@/app/api/outcomes/reports/latest/route");

    const runResponse = await POST(makeJsonRequest("http://localhost:8080/api/outcomes/reports/run", token, { range_days: 30 }));
    const runBody = await runResponse.json();
    const { runOutcomeJobNow } = await import("@/lib/server/outcome-jobs");
    const completed = await runOutcomeJobNow(runBody.job.id);
    const jobResult = JSON.parse(completed.result_json || "{}");
    const latestResponse = await GET(makeRequest("http://localhost:8080/api/outcomes/reports/latest", token));
    const latestBody = await latestResponse.json();

    expect(runResponse.status).toBe(202);
    expect(runBody.job).toMatchObject({
      kind: "learning_report",
      status: "queued",
    });
    expect(completed.status).toBe("completed");
    expect(jobResult.report).toMatchObject({
      status: "completed",
      range_days: 30,
      total_work_items: 1,
      resolved_pr_count: 0,
    });
    expect(latestResponse.status).toBe(200);
    expect(latestBody.report.id).toBe(jobResult.report.id);
    expect(latestBody.report.report.counts.no_pr_excluded).toBe(1);
  });
});

describe("GET /api/outcomes/jobs/[jobId]", () => {
  it("requires authentication", async () => {
    const { GET } = await import("@/app/api/outcomes/jobs/[jobId]/route");

    const response = await GET(
      makeRequest("http://localhost:8080/api/outcomes/jobs/1"),
      { params: Promise.resolve({ jobId: "1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns queued job status for the requesting user", async () => {
    const token = await createAuthToken();
    const work = createWorkItem({ appName: "Job API App" });
    const apps = getAppRows().filter((app) => app.id === work.appId);
    const { enqueueOutcomeJob } = await import("@/lib/server/outcome-jobs");
    const job = enqueueOutcomeJob({ kind: "snapshot_recompute", userId: 1, apps });
    const { GET } = await import("@/app/api/outcomes/jobs/[jobId]/route");

    const response = await GET(
      makeRequest(`http://localhost:8080/api/outcomes/jobs/${job.id}`, token),
      { params: Promise.resolve({ jobId: String(job.id) }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.job).toMatchObject({
      id: job.id,
      kind: "snapshot_recompute",
      status: "queued",
    });
  });
});

describe("POST /api/outcomes/followups/detect", () => {
  it("requires authentication", async () => {
    const { POST } = await import("@/app/api/outcomes/followups/detect/route");

    const response = await POST(makeJsonRequest("http://localhost:8080/api/outcomes/followups/detect"));

    expect(response.status).toBe(401);
  });

  it("queues follow-up detection without a default candidate cap", async () => {
    const token = await createAuthToken();
    const { POST } = await import("@/app/api/outcomes/followups/detect/route");

    const response = await POST(makeJsonRequest("http://localhost:8080/api/outcomes/followups/detect", token, { range_days: 14 }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.job).toMatchObject({
      kind: "followup_detection",
      status: "queued",
    });
    expect(JSON.parse(body.job.input_json)).not.toHaveProperty("maxCandidates");
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
