import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { canAccessApp } from "@/lib/server/route-utils";

export async function GET(request: NextRequest, { params }: { params: Promise<{ reviewId: string }> }) {
  let user: Awaited<ReturnType<typeof getAuthUser>>;
  try { user = await getAuthUser(request); }
  catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    throw error;
  }
  const reviewId = Number.parseInt((await params).reviewId, 10);
  if (!Number.isInteger(reviewId) || reviewId <= 0) return NextResponse.json({ detail: "Invalid review ID" }, { status: 400 });
  const review = dal.getPullRequestReview(reviewId);
  if (!review) return NextResponse.json({ detail: "Review not found" }, { status: 404 });
  const app = dal.getApp(review.app_id);
  if (!app) return NextResponse.json({ detail: "Review project not found" }, { status: 404 });
  if (!canAccessApp(user, app)) {
    const error = new ForbiddenError("App access required");
    return NextResponse.json({ detail: error.message }, { status: 403 });
  }
  return NextResponse.json({ review, findings: dal.listReviewFindings(reviewId) });
}
