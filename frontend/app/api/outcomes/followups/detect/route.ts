import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { enqueueOutcomeJob, serializeOutcomeJob } from "@/lib/server/outcome-jobs";
import { getOutcomesGitHubSyncSettings } from "@/lib/server/outcomes-github-sync";
import { filterAppsForUser } from "@/lib/server/room-route-utils";

function parsePositiveInt(value: unknown, label: string, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${label} must be an integer from 1 to ${max}`);
  }
  return parsed;
}

function parseOptionalPositiveInt(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseRange(body: Record<string, unknown>): {
  rangeDays: number | null;
  rangeStart: string | null;
  rangeEnd: string | null;
} {
  const settings = getOutcomesGitHubSyncSettings();
  const rawDays = body.range_days ?? 90;
  const rangeDays = rawDays === null ? null : Number(rawDays);
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
  return {
    rangeDays: rangeStart ? null : rangeDays || settings.observation_window_days,
    rangeStart,
    rangeEnd,
  };
}

export async function POST(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthUser>>;
  try {
    user = await getAuthUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ detail: error.message }, { status: 401 });
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
  let observationDays: number;
  let maxCandidates: number | undefined;
  try {
    const settings = getOutcomesGitHubSyncSettings();
    range = parseRange(body);
    observationDays = parsePositiveInt(body.observation_days, "observation_days", settings.observation_window_days, 365);
    maxCandidates = parseOptionalPositiveInt(body.max_candidates, "max_candidates");
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Invalid follow-up detection request" },
      { status: 400 },
    );
  }

  const apps = filterAppsForUser(user, dal.getApps());
  const job = enqueueOutcomeJob({
    kind: "followup_detection",
    userId: user.id,
    apps,
    input: {
      observationDays,
      rangeDays: range.rangeStart ? null : range.rangeDays,
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
      maxCandidates,
    },
  });
  return NextResponse.json({ job: serializeOutcomeJob(job) }, { status: 202 });
}
