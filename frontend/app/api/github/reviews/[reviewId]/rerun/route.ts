import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireAdmin } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { getGitHubAppInstallationToken } from "@/lib/server/github-app";
import { getGitHubPullRequestIdentity } from "@/lib/server/github-review-api";
import { startPullRequestReview } from "@/lib/server/pull-request-review-jobs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ reviewId: string }> }) {
  try { await requireAdmin(request); }
  catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ detail: error.message }, { status: 403 });
    throw error;
  }
  const reviewId = Number.parseInt((await params).reviewId, 10);
  if (!Number.isInteger(reviewId) || reviewId <= 0) return NextResponse.json({ detail: "Invalid review ID" }, { status: 400 });
  const review = dal.getPullRequestReview(reviewId);
  if (!review) return NextResponse.json({ detail: "Review not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const mode = body?.mode === "full" ? "full" : "targeted";
  try {
    const token = (await getGitHubAppInstallationToken(review.installation_id, review.repo)).token;
    const identity = await getGitHubPullRequestIdentity({
      owner: review.owner,
      repo: review.repo,
      prNumber: review.pr_number,
      token,
    });
    const queued = dal.queueManualPullRequestReview(review, mode, identity);
    startPullRequestReview(queued.id);
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      detail: error instanceof Error ? error.message : "Unable to load the current pull request state.",
    }, { status: 502 });
  }
}
