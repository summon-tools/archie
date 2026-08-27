import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
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

function summarizeReview(review: PullRequestReviewSummaryRow) {
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

  const active = dal.listActivePullRequestReviewSummaries(filters).map(summarizeReview);
  const historyRows = dal.listPullRequestReviewHistoryGroups(filters, page, pageSize);
  const historyTotal = dal.countPullRequestReviewHistoryGroups(filters);
  const history = historyRows.map((review) => ({
    key: `${review.app_id}:${review.owner.toLowerCase()}/${review.repo.toLowerCase()}#${review.pr_number}`,
    latest: summarizeReview(review),
    run_count: Number(review.review_run_count || 1),
    runs: dal.listPullRequestReviewRunsForHistoryGroup({
      app_id: review.app_id,
      owner: review.owner,
      repo: review.repo,
      pr_number: review.pr_number,
    }).map(summarizeReview),
  }));
  const pageCount = Math.max(1, Math.ceil(historyTotal / pageSize));

  return NextResponse.json({
    active,
    history,
    counts: dal.getPullRequestReviewStatusCounts(filters),
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
