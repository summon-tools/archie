import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import {
  combineReviewCostSummaries,
  parseReviewCostSummary,
  type ReviewCostSummary,
} from "@/lib/server/review-costs";
import type { PullRequestReviewSummaryRow } from "@/lib/server/types";

function positiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function reviewPhase(review: PullRequestReviewSummaryRow): string {
  if (review.status === "queued") return "queued";
  if (review.status === "completed") return "review_published";
  if (review.status === "failed") return "failed";
  if (review.status === "not_supported") return "not_supported";
  const execution = parseJsonObject(review.execution_json);
  return typeof execution.phase === "string" && execution.phase ? execution.phase : "starting";
}

function publicationUrl(review: PullRequestReviewSummaryRow): string | null {
  const publication = parseJsonObject(review.publication_json);
  if (typeof publication.html_url === "string" && publication.html_url) return publication.html_url;
  return null;
}

function publicSpend(summary: ReviewCostSummary, followUpCalls = 0) {
  return {
    model_calls: summary.model_calls,
    follow_up_calls: followUpCalls,
    known_cost_usd: summary.known_cost_usd,
    reported_cost_usd: summary.reported_cost_usd,
    estimated_cost_usd: summary.estimated_cost_usd,
    unknown_cost_calls: summary.unknown_cost_calls,
    cost_source: summary.cost_source,
    usage: summary.usage,
  };
}

function summarizeReview(review: PullRequestReviewSummaryRow, spend: ReturnType<typeof publicSpend>) {
  return {
    id: review.id,
    app_id: review.app_id,
    app_name: review.app_name,
    owner: review.owner,
    repo: review.repo,
    pr_number: review.pr_number,
    pr_title: review.pr_title,
    pr_url: review.pr_url || `https://github.com/${review.owner}/${review.repo}/pull/${review.pr_number}`,
    github_review_url: publicationUrl(review),
    status: review.status,
    phase: reviewPhase(review),
    review_mode: review.review_mode,
    action: review.action,
    findings_count: Number(review.findings_count || 0),
    review_run_count: Number(review.review_run_count || 1),
    provider_id: review.provider_id,
    model_id: review.model_id,
    created_at: review.created_at,
    updated_at: review.updated_at,
    completed_at: review.completed_at,
    failure_message: review.status === "failed"
      ? "Archie could not complete this review. Check the project configuration or retry the review."
      : null,
    spend,
  };
}

export async function GET(request: NextRequest) {
  try {
    await getAuthUser(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    throw error;
  }

  const appId = positiveInteger(request.nextUrl.searchParams.get("app_id"), 0) || undefined;
  const search = request.nextUrl.searchParams.get("search")?.trim().slice(0, 120) || undefined;
  const page = positiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(50, positiveInteger(request.nextUrl.searchParams.get("page_size"), 20));
  const filters = { app_id: appId, search };

  const costRecords = dal.listPullRequestReviewCostRecords(filters);
  const interactionRecords = dal.listReviewThreadInteractionCostRecords(filters);
  const interactionsByReview = new Map<number, typeof interactionRecords>();
  for (const interaction of interactionRecords) {
    const existing = interactionsByReview.get(interaction.review_id) || [];
    existing.push(interaction);
    interactionsByReview.set(interaction.review_id, existing);
  }
  const costsByReview = new Map<number, { summary: ReviewCostSummary; follow_up_calls: number }>();
  for (const review of costRecords) {
    const fallbackReviewCalls = review.provider_id && review.model_id ? 2 : 0;
    const reviewCost = parseReviewCostSummary(review.model_usage_json, fallbackReviewCalls);
    const interactionCosts = (interactionsByReview.get(review.id) || []).map((interaction) => (
      parseReviewCostSummary(interaction.model_usage_json, interaction.status === "completed" ? 1 : 0)
    ));
    costsByReview.set(review.id, {
      summary: combineReviewCostSummaries([reviewCost, ...interactionCosts]),
      follow_up_calls: interactionCosts.reduce((total, cost) => total + cost.model_calls, 0),
    });
  }
  const emptyCost = combineReviewCostSummaries([]);
  const spendForReview = (reviewId: number) => {
    const cost = costsByReview.get(reviewId);
    return publicSpend(cost?.summary || emptyCost, cost?.follow_up_calls || 0);
  };
  const totalCost = combineReviewCostSummaries([...costsByReview.values()].map((cost) => cost.summary));
  const totalFollowUpCalls = [...costsByReview.values()].reduce((total, cost) => total + cost.follow_up_calls, 0);

  const active = dal.listActivePullRequestReviewSummaries(filters).map((review) => summarizeReview(review, spendForReview(review.id)));
  const historyRows = dal.listPullRequestReviewHistoryGroups(filters, page, pageSize);
  const historyTotal = dal.countPullRequestReviewHistoryGroups(filters);
  const history = historyRows.map((review) => {
    const runRows = dal.listPullRequestReviewRunsForHistoryGroup({
      app_id: review.app_id,
      owner: review.owner,
      repo: review.repo,
      pr_number: review.pr_number,
    });
    const groupCosts = costRecords
      .filter((record) => record.app_id === review.app_id
        && record.owner.toLowerCase() === review.owner.toLowerCase()
        && record.repo.toLowerCase() === review.repo.toLowerCase()
        && record.pr_number === review.pr_number)
      .map((record) => costsByReview.get(record.id))
      .filter(Boolean) as Array<{ summary: ReviewCostSummary; follow_up_calls: number }>;
    return {
      key: `${review.app_id}:${review.owner.toLowerCase()}/${review.repo.toLowerCase()}#${review.pr_number}`,
      latest: summarizeReview(review, spendForReview(review.id)),
      run_count: Number(review.review_run_count || 1),
      runs: runRows.map((run) => summarizeReview(run, spendForReview(run.id))),
      spend: publicSpend(
        combineReviewCostSummaries(groupCosts.map((cost) => cost.summary)),
        groupCosts.reduce((total, cost) => total + cost.follow_up_calls, 0),
      ),
    };
  });
  const pageCount = Math.max(1, Math.ceil(historyTotal / pageSize));

  return NextResponse.json({
    active,
    history,
    counts: dal.getPullRequestReviewStatusCounts(filters),
    spend: publicSpend(totalCost, totalFollowUpCalls),
    projects: dal.listPullRequestReviewProjects(),
    pagination: {
      page,
      page_size: pageSize,
      total_groups: historyTotal,
      page_count: pageCount,
      has_previous: page > 1,
      has_next: page < pageCount,
    },
    generated_at: new Date().toISOString(),
  });
}
