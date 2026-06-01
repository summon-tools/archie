import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { serializeOutcomeJob } from "@/lib/server/outcome-jobs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  let user: Awaited<ReturnType<typeof getAuthUser>>;
  try {
    user = await getAuthUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ detail: error.message }, { status: 401 });
    }
    throw error;
  }

  const { jobId } = await params;
  const id = Number(jobId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ detail: "Invalid outcome job id" }, { status: 400 });
  }

  const job = dal.getLlmOutcomeJob(id);
  if (!job) {
    return NextResponse.json({ detail: "Outcome job not found" }, { status: 404 });
  }
  if (job.requested_by_user_id !== user.id && user.role !== "admin") {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ job: serializeOutcomeJob(job) });
}
