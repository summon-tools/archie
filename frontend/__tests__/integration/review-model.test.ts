import { describe, expect, it } from "vitest";
import { generateValidatedReview } from "@/lib/server/review-model";
import type { ReviewContextPacket } from "@/lib/server/review-context";

const context: ReviewContextPacket = {
  review: {
    id: 1,
    owner: "acme",
    repo: "web",
    number: 12,
    base_sha: "base",
    head_sha: "head",
    comparison_sha: "base",
    mode: "targeted",
  },
  pull_request: { title: "Update API client", body: "", html_url: "https://github.com/acme/web/pull/12" },
  files: [{ filename: "src/client.ts", status: "modified", additions: 1, deletions: 0, changes: 1, patch: "@@ -1,1 +1,2 @@\n export const x = 1;\n+export const y = 2;" }],
  publication_files: [{ filename: "src/client.ts", status: "modified", additions: 1, deletions: 0, changes: 1, patch: "@@ -1,1 +1,2 @@\n export const x = 1;\n+export const y = 2;" }],
  diff: "+export const y = 2;",
  checks: [],
  comments: { issue: [], review: [], submitted_reviews: [] },
  local_checks: [],
  task: null,
  policy: { priorities: ["correctness"], severity_guidance: "advisory", required_checks: [], behavior: [], tone: "concise" },
  policy_revision: "default-v1",
  contracts: [],
  previous_findings: [],
  warnings: [],
  sources: ["github_pull_request", "github_changed_files", "github_diff"],
};

describe("review model publication gate", () => {
  it("keeps only evidence-backed findings on changed right-side lines", async () => {
    const calls: string[] = [];
    const result = await generateValidatedReview({
      context,
      runner: async (_prompt, phase) => {
        calls.push(phase);
        if (phase === "discover") {
          return JSON.stringify({ summary: "Candidates", findings: [
            { path: "src/client.ts", line: 2, title: "Unsafe client behavior", body: "This changed line can fail when the response is empty; return a guarded value before using it.", severity: "medium", evidence: "Changed line 2" },
            { path: "README.md", line: 1, title: "Style", body: "This is not an actionable correctness concern and should be ignored.", evidence: "style" },
          ] });
        }
        return JSON.stringify({ summary: "Verified", findings: [
          { path: "src/client.ts", line: 2, title: "Unsafe client behavior", body: "This changed line can fail when the response is empty; return a guarded value before using it.", severity: "medium", evidence: "Changed line 2" },
          { path: "src/client.ts", line: 1, title: "Unchanged line", body: "This line is not part of the patch and should not receive an inline comment.", evidence: "Unchanged" },
        ] });
      },
    });
    expect(calls).toEqual(["discover", "verify"]);
    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0].path).toBe("src/client.ts");
    expect(result.output.findings[0].line).toBe(2);
    expect(result.output.summary).toContain("Context used:");
  });

  it("does not publish a finding summary when every candidate fails validation", async () => {
    const result = await generateValidatedReview({
      context,
      runner: async (_prompt, phase) => JSON.stringify({
        summary: phase === "verify" ? "One advisory compatibility finding is publishable." : "Candidate",
        findings: phase === "verify" ? [{
          path: "src/client.ts",
          line: 1,
          title: "Compatibility risk",
          body: "This candidate points to an unchanged line and must not be published as an inline finding.",
          evidence: "Unchanged line",
        }] : [],
      }),
    });

    expect(result.output.findings).toHaveLength(0);
    expect(result.output.summary).toContain("did not identify any high-confidence findings after validation");
    expect(result.output.summary).not.toContain("One advisory compatibility finding is publishable");
    expect(result.validation_rejections).toMatchObject([{
      path: "src/client.ts",
      line: 1,
      reason: "line_not_changed",
    }]);
  });

  it("rejects empty structured evidence", async () => {
    const result = await generateValidatedReview({
      context,
      runner: async (_prompt, phase) => JSON.stringify({
        summary: "Candidate",
        findings: phase === "verify" ? [{
          path: "src/client.ts",
          line: 2,
          title: "Missing evidence",
          body: "This otherwise actionable candidate has no concrete supporting evidence.",
          evidence: {},
        }] : [],
      }),
    });

    expect(result.output.findings).toHaveLength(0);
    expect(result.validation_rejections).toMatchObject([{ reason: "missing_evidence" }]);
  });

  it("rejects a targeted finding that cannot be published on the full pull-request diff", async () => {
    const targetedContext: ReviewContextPacket = {
      ...context,
      publication_files: [{
        filename: "src/client.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        changes: 1,
        patch: "@@ -4,0 +5,1 @@\n+export const z = 3;",
      }],
    };
    const result = await generateValidatedReview({
      context: targetedContext,
      runner: async (_prompt, phase) => JSON.stringify({
        summary: "Candidate",
        findings: phase === "verify" ? [{
          path: "src/client.ts",
          line: 2,
          title: "Stale target line",
          body: "This targeted line is not present in the full pull-request publication diff.",
          evidence: "Targeted comparison line 2",
        }] : [],
      }),
    });

    expect(result.output.findings).toHaveLength(0);
    expect(result.validation_rejections).toMatchObject([{ reason: "line_not_in_pull_request_diff" }]);
  });
});
