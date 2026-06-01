import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { GitHubAppError, getValidGitHubUserToken } from "@/lib/server/github-app";
import { recomputeOutcomeSnapshots } from "@/lib/server/outcome-snapshots";
import { filterAppsForUser } from "@/lib/server/room-route-utils";
import { getOutcomesGitHubSyncSettings, runGitHubEvidenceSync } from "@/lib/server/outcomes-github-sync";

function parseRange(body: Record<string, unknown>): {
  rangeDays: number | null;
  rangeStart: string | null;
  rangeEnd: string | null;
} {
  const settings = getOutcomesGitHubSyncSettings();
  const rawDays = body.range_days ?? settings.observation_window_days;
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
  return { rangeDays, rangeStart, rangeEnd };
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
  try {
    range = parseRange(body);
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Invalid sync range" }, { status: 400 });
  }

  let githubAuth;
  try {
    githubAuth = await getValidGitHubUserToken(user.id);
  } catch (error) {
    if (error instanceof GitHubAppError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    throw error;
  }

  const apps = filterAppsForUser(user, dal.getApps());
  const result = await runGitHubEvidenceSync({
    apps,
    userId: user.id,
    githubToken: githubAuth.token,
    mode: "manual",
    rangeDays: range.rangeStart ? null : range.rangeDays,
    rangeStart: range.rangeStart,
    rangeEnd: range.rangeEnd,
    maxPrs: 50,
  });
  const recomputed = recomputeOutcomeSnapshots({
    apps,
    rangeDays: range.rangeStart ? null : range.rangeDays,
    rangeStart: range.rangeStart,
    rangeEnd: range.rangeEnd,
  });

  return NextResponse.json({ ...result, recomputed_snapshots: recomputed.recomputed_count });
}
