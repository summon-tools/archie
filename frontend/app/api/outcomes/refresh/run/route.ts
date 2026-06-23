import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireAdmin } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { enqueueOutcomeJob, serializeOutcomeJob } from "@/lib/server/outcome-jobs";
import { filterAppsForUser } from "@/lib/server/room-route-utils";

function parseRange(body: Record<string, unknown>): {
  rangeDays: number | null;
  rangeStart: string | null;
  rangeEnd: string | null;
} {
  const rawDays = body.range_days;
  const rangeDays = rawDays === undefined || rawDays === null ? null : Number(rawDays);
  if (rangeDays !== null && (!Number.isInteger(rangeDays) || rangeDays < 1 || rangeDays > 365)) {
    throw new Error("range_days must be an integer from 1 to 365");
  }

  const rangeStart = typeof body.range_start === "string" && body.range_start.trim()
    ? body.range_start.trim()
    : null;
  const rangeEnd = typeof body.range_end === "string" && body.range_end.trim()
    ? body.range_end.trim()
    : null;
  for (const [label, value] of [["range_start", rangeStart], ["range_end", rangeEnd]] as const) {
    if (value && Number.isNaN(Date.parse(value))) {
      throw new Error(`${label} must be a valid date`);
    }
  }
  return { rangeDays, rangeStart, rangeEnd };
}

export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    user = await requireAdmin(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ detail: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ detail: error.message }, { status: 403 });
    }
    throw error;
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  } catch {
    body = {};
  }

  let range;
  try {
    range = parseRange(body);
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Invalid refresh request" },
      { status: 400 },
    );
  }

  const apps = filterAppsForUser(user, dal.getApps());
  const job = enqueueOutcomeJob({
    kind: "outcome_refresh",
    userId: user.id,
    apps,
    input: {
      rangeDays: range.rangeStart ? null : range.rangeDays,
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
      fullRefresh: body.full_refresh === true,
    },
  });
  return NextResponse.json({ job: serializeOutcomeJob(job) }, { status: 202 });
}
