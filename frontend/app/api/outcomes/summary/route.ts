import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError, requireAdmin } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { filterAppsForUser } from "@/lib/server/room-route-utils";
import { buildOutcomesSummary, type OutcomeRowFilters } from "@/lib/server/outcomes";
import type { OutcomeState } from "@/lib/types";

const OUTCOME_STATE_VALUES: OutcomeState[] = ["pending_pr", "merged", "closed_unmerged", "no_pr", "unknown"];
const OUTCOME_STATES = new Set<OutcomeState>(OUTCOME_STATE_VALUES);
const PR_STATES = new Set(["OPEN", "CLOSED", "MERGED", "UNKNOWN", "NO_PR"]);

function positiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFilters(request: NextRequest): OutcomeRowFilters {
  const params = request.nextUrl.searchParams;
  const appId = params.get("app_id");
  const outcomeState = params.get("outcome_state");
  const prState = params.get("pr_state");
  return {
    appId: appId ? positiveInt(appId, 0) || null : null,
    outcomeState: outcomeState && OUTCOME_STATES.has(outcomeState as OutcomeState)
      ? outcomeState as OutcomeState
      : null,
    providerId: params.get("provider") || null,
    modelId: params.get("model") || null,
    runStatus: params.get("run_status") || null,
    prState: prState && PR_STATES.has(prState) ? prState : null,
  };
}

export async function GET(request: NextRequest) {
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

  const apps = filterAppsForUser(user, dal.getApps());
  const page = positiveInt(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(200, positiveInt(request.nextUrl.searchParams.get("page_size"), 25));
  const pagesByState = OUTCOME_STATE_VALUES.reduce((acc, state) => {
    acc[state] = positiveInt(request.nextUrl.searchParams.get(`${state}_page`), 1);
    return acc;
  }, {} as Record<OutcomeState, number>);

  try {
    const includeRows = request.nextUrl.searchParams.get("include_rows") !== "false";
    const summary = await buildOutcomesSummary({
      apps,
      refreshGitHubState: false,
      includeRows,
      rowFilters: parseFilters(request),
      pagination: { page, pageSize },
      groupPagination: { pageSize, pagesByState },
    });
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Failed to load outcomes summary" },
      { status: 500 },
    );
  }
}
