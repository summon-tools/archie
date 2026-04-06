import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { getSpecJob, clearSpecJob } from "@/lib/server/spec-jobs";

/**
 * GET: Poll current spec job status for an app.
 * Returns the job state or { job: null } if no job.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    const job = getSpecJob(Number(appId));
    return NextResponse.json({ job });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * DELETE: Clear a completed/failed job so the frontend stops showing it.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    clearSpecJob(Number(appId));
    return NextResponse.json({ cleared: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}
