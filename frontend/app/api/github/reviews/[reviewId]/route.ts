import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

export async function GET(request: NextRequest, { params }: { params: Promise<{ reviewId: string }> }) {
  try { await getAuthUser(request); }
  catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    throw error;
  }
  const reviewId = Number.parseInt((await params).reviewId, 10);
  if (!Number.isInteger(reviewId) || reviewId <= 0) return NextResponse.json({ detail: "Invalid review ID" }, { status: 400 });
  const review = dal.getPullRequestReview(reviewId);
  if (!review) return NextResponse.json({ detail: "Review not found" }, { status: 404 });
  return NextResponse.json({ review, findings: dal.listReviewFindings(reviewId) });
}
