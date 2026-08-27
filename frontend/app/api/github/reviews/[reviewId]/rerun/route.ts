import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireAdmin } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
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
  const queued = dal.queueManualPullRequestReview(review, mode);
  startPullRequestReview(queued.id);
  return NextResponse.json(queued, { status: 202 });
}
