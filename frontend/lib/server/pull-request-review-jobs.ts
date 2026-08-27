import * as dal from "@/lib/server/dal";
import { getGitHubAppInstallationToken, getGitHubAppSettings } from "@/lib/server/github-app";
import {
  createReviewWorktree,
  removeReviewWorktree,
  sweepOrphanedReviewWorktrees,
  type ReviewWorktree,
  type ReviewWorktreeSweepResult,
} from "@/lib/server/review-worktrees";
import { runReviewChecks, type ReviewCheckResult } from "@/lib/server/review-checks";
import { buildReviewContext } from "@/lib/server/review-context";
import { generateValidatedReview, type ReviewModelRunner } from "@/lib/server/review-model";
import { reviewCostPersistenceFields, summarizeReviewModelCalls } from "@/lib/server/review-costs";
import { createGitHubIssueComment, publishGitHubReview } from "@/lib/server/github-review-api";
import type { PullRequestReviewRow } from "@/lib/server/types";

const runningReviews = new Set<number>();
const REVIEW_WORKER_INTERVAL_MS = 5000;
const REVIEW_HEARTBEAT_INTERVAL_MS = 60000;
let workerInterval: ReturnType<typeof setInterval> | null = null;

function executionPayload(fields: Record<string, unknown>): string {
  return JSON.stringify({
    ...fields,
    updated_at: new Date().toISOString(),
  });
}

function summarizeChecks(checks: ReviewCheckResult[]) {
  return {
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
    checks,
  };
}

export interface PullRequestReviewRunOptions {
  modelRunner?: ReviewModelRunner;
  checksOnly?: boolean;
}

function publicFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Review execution failed.";
  if (/worktree|fetch|commit|repository/i.test(message)) return "Archie could not prepare the pull request code for local review.";
  if (/model|json|provider|query/i.test(message)) return "Archie could not complete the model review.";
  if (/github|publication|review/i.test(message)) return "Archie could not publish the advisory review.";
  return "Archie could not complete this review.";
}

async function markReviewFailed(
  review: PullRequestReviewRow,
  error: unknown,
  installationToken?: string | null,
): Promise<PullRequestReviewRow> {
  const errorText = error instanceof Error ? error.message : "Review execution failed.";
  const userMessage = publicFailureMessage(error);
  let failureComment: { id: number; html_url: string | null } | null = null;
  try {
    const token = installationToken || (await getGitHubAppInstallationToken(review.installation_id, review.repo)).token;
    failureComment = await createGitHubIssueComment({
      owner: review.owner,
      repo: review.repo,
      issueNumber: review.pr_number,
      body: `${userMessage}\n\nThe review was not published. Fix the configuration or transient failure, then run the Archie review command again.`,
      token,
    });
  } catch {
    // Persist the original failure even when GitHub is unavailable.
  }
  return dal.updatePullRequestReview(review.id, {
    status: "failed",
    error_text: errorText,
    execution_json: executionPayload({ phase: "failed", error: errorText }),
    publication_json: JSON.stringify({ failure_comment: failureComment }),
    completed_at: new Date().toISOString(),
  })!;
}

export function startPullRequestReview(reviewId: number): void {
  if (process.env.NODE_ENV === "test" || runningReviews.has(reviewId)) return;
  runningReviews.add(reviewId);
  setTimeout(() => {
    runPullRequestReviewNow(reviewId)
      .catch(() => {})
      .finally(() => runningReviews.delete(reviewId));
  }, 0);
}

export function recoverPendingPullRequestReviews(): number {
  if (process.env.NODE_ENV === "test") return 0;
  const recoverable = dal.listRecoverablePullRequestReviews();
  for (const review of recoverable) startPullRequestReview(review.id);
  return recoverable.length;
}

export function sweepReviewWorktreesOnStartup(): ReviewWorktreeSweepResult {
  const total: ReviewWorktreeSweepResult = { removed: 0, kept: 0, warnings: [] };
  for (const app of dal.getApps()) {
    if (!app.directory) continue;
    const activeReviewIds = dal.listActivePullRequestReviewsForApp(app.id).map((review) => review.id);
    const result = sweepOrphanedReviewWorktrees({ appDirectory: app.directory, activeReviewIds });
    total.removed += result.removed;
    total.kept += result.kept;
    total.warnings.push(...result.warnings.map((warning) => `${app.name}: ${warning}`));
  }
  return total;
}

export function startPullRequestReviewWorker(): void {
  if (process.env.NODE_ENV === "test" || workerInterval) return;
  recoverPendingPullRequestReviews();
  workerInterval = setInterval(recoverPendingPullRequestReviews, REVIEW_WORKER_INTERVAL_MS);
  workerInterval.unref?.();
}

export async function runPullRequestReviewNow(reviewId: number, options: PullRequestReviewRunOptions = {}): Promise<PullRequestReviewRow> {
  const existing = dal.getPullRequestReview(reviewId);
  if (!existing) throw new Error("Pull request review not found");
  if (existing.status === "completed" || existing.status === "failed" || existing.status === "not_supported") {
    return existing;
  }

  if (!dal.claimPullRequestReview(reviewId)) {
    return dal.getPullRequestReview(reviewId) || existing;
  }

  dal.updatePullRequestReview(reviewId, {
    execution_mode: "isolated_worktree",
    execution_json: executionPayload({ phase: "starting" }),
    context_sources_json: JSON.stringify(["github_webhook"]),
  });

  const app = dal.getApp(existing.app_id);
  if (!app?.directory) {
    return markReviewFailed(existing, new Error("The mapped project has no local directory."));
  }
  if (!existing.head_sha) {
    return markReviewFailed(existing, new Error("The review has no head SHA."));
  }

  let worktree: ReviewWorktree | undefined;
  let executionResult: PullRequestReviewRow | undefined;
  let installationToken: string | null = null;
  const heartbeat = setInterval(() => dal.touchPullRequestReview(reviewId), REVIEW_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();
  try {
    const githubSettings = getGitHubAppSettings();
    if (githubSettings.app_id && githubSettings.private_key) {
      installationToken = (await getGitHubAppInstallationToken(existing.installation_id, existing.repo)).token;
    }

    const created = createReviewWorktree({
      appDirectory: app.directory,
      reviewId,
      headSha: existing.head_sha,
      token: installationToken,
    });
    if (!created.success || !created.worktree) {
      throw new Error(created.message);
    } else {
      worktree = created.worktree;
      dal.updatePullRequestReview(reviewId, {
        workspace_path: worktree.worktree_dir,
        execution_json: executionPayload({ phase: "worktree_ready", head_sha: worktree.head_sha }),
        context_sources_json: JSON.stringify(["github_webhook", "isolated_worktree"]),
      });

      const checks = runReviewChecks({
        worktreeDir: worktree.worktree_dir,
        baseSha: existing.base_sha,
        headSha: existing.head_sha,
      });
      const checkSummary = summarizeChecks(checks);
      if (options.checksOnly) {
        executionResult = dal.updatePullRequestReview(reviewId, {
          status: "completed",
          execution_json: executionPayload({
            phase: "checks_completed",
            head_sha: worktree.head_sha,
            review_skipped: "Checks-only execution requested by the caller.",
            ...checkSummary,
          }),
          context_sources_json: JSON.stringify(["github_webhook", "isolated_worktree", "local_checks"]),
          comparison_sha: existing.head_sha,
          completed_at: new Date().toISOString(),
        });
      } else {
        if (!installationToken) throw new Error("GitHub App installation authentication is not configured.");
        const context = await buildReviewContext({
          review: existing,
          worktreeDir: worktree.worktree_dir,
          token: installationToken,
          localChecks: checks.map((check) => ({ ...check })) as Array<Record<string, unknown>>,
        });
        dal.updatePullRequestReview(reviewId, {
          pr_url: typeof context.pull_request.html_url === "string" ? context.pull_request.html_url : null,
          pr_title: typeof context.pull_request.title === "string" ? context.pull_request.title : null,
          pr_body: typeof context.pull_request.body === "string" ? context.pull_request.body : null,
          context_packet_json: JSON.stringify(context),
          context_sources_json: JSON.stringify(context.sources),
          policy_revision: context.policy_revision,
          comparison_sha: context.review.comparison_sha,
          execution_json: executionPayload({
            phase: "context_ready",
            head_sha: worktree.head_sha,
            warnings: context.warnings,
            files: context.files.length,
            contracts: context.contracts.length,
            ...checkSummary,
          }),
        });
        const modelStartedAt = Date.now();
        const generated = await generateValidatedReview({
          context,
          runner: options.modelRunner,
          onModelCall: (call, calls) => {
            const partialCost = summarizeReviewModelCalls(calls);
            dal.updatePullRequestReview(reviewId, {
              provider_id: call.provider_id,
              model_id: call.model_id,
              model_usage_json: JSON.stringify({
                ...reviewCostPersistenceFields(partialCost),
                duration_ms: Date.now() - modelStartedAt,
              }),
            });
          },
        });
        const modelDurationMs = Date.now() - modelStartedAt;
        const findings = generated.output.findings.map((finding) => dal.createReviewFinding({
          review_id: reviewId,
          path: finding.path,
          line: finding.line,
          end_line: finding.end_line ?? null,
          side: "RIGHT",
          start_side: finding.start_side ?? null,
          title: finding.title,
          body: finding.body,
          severity: finding.severity || "advisory",
          evidence_json: JSON.stringify(finding.evidence),
        }));
        const publication = await publishGitHubReview({
          owner: existing.owner,
          repo: existing.repo,
          prNumber: existing.pr_number,
          commitId: existing.head_sha,
          body: generated.output.summary,
          comments: findings.map((finding) => ({
            path: finding.path,
            line: finding.end_line ?? finding.line,
            side: finding.side,
            ...(finding.end_line && finding.end_line !== finding.line ? { start_line: finding.line, start_side: finding.start_side || finding.side } : {}),
            body: `**${finding.title}**\n\n${finding.body}`,
          })),
          token: installationToken,
        });
        for (const [index, finding] of findings.entries()) {
          const publishedComment = publication.comments[index];
          dal.updateReviewFinding(finding.id, {
            status: "published",
            github_comment_id: publishedComment?.id || null,
            github_comment_url: publishedComment?.html_url || publication.html_url,
          });
        }
        executionResult = dal.updatePullRequestReview(reviewId, {
          status: "completed",
          pr_url: typeof context.pull_request.html_url === "string" ? context.pull_request.html_url : null,
          pr_title: typeof context.pull_request.title === "string" ? context.pull_request.title : null,
          pr_body: typeof context.pull_request.body === "string" ? context.pull_request.body : null,
          context_packet_json: JSON.stringify(context),
          execution_json: executionPayload({
            phase: "review_published",
            head_sha: worktree.head_sha,
            findings: findings.length,
            ...checkSummary,
          }),
          publication_json: JSON.stringify(publication),
          github_review_id: publication.id,
          provider_id: generated.provider_id,
          model_id: generated.model_id,
          model_usage_json: JSON.stringify({
            prompt_hash: generated.prompt_hash,
            findings: findings.length,
            validation_rejections: generated.validation_rejections,
            duration_ms: modelDurationMs,
            ...reviewCostPersistenceFields(generated.cost_summary),
          }),
          context_sources_json: JSON.stringify(context.sources),
          policy_revision: context.policy_revision,
          comparison_sha: context.review.comparison_sha,
          completed_at: new Date().toISOString(),
        })!;
      }
    }
  } catch (error) {
    executionResult = await markReviewFailed(existing, error, installationToken);
  } finally {
    clearInterval(heartbeat);
    if (worktree) {
      const cleanup = removeReviewWorktree(worktree, app.directory);
      const latest = dal.getPullRequestReview(reviewId);
      if (latest) {
        let execution: Record<string, unknown> = {};
        try { execution = JSON.parse(latest.execution_json); } catch {}
        dal.updatePullRequestReview(reviewId, {
          workspace_path: null,
          execution_json: executionPayload({
            ...execution,
            cleanup: cleanup.success ? "completed" : "warning",
            cleanup_message: cleanup.message,
          }),
        });
      }
    }
  }

  return dal.getPullRequestReview(reviewId) || executionResult!;
}
