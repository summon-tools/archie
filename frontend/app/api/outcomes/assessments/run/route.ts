import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { runOutcomeEvidenceAssessment } from "@/lib/server/outcome-assessments";
import { filterAppsForUser } from "@/lib/server/room-route-utils";

function parseWorkItemIds(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("work_item_ids must be an array");
  if (value.length > 250) throw new Error("work_item_ids cannot contain more than 250 items");
  const ids = value.map((entry) => {
    const parsed = typeof entry === "number" ? entry : Number(entry);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("work_item_ids must contain positive integers");
    }
    return parsed;
  });
  return Array.from(new Set(ids));
}

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

function parseMaxItems(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("max_items must be an integer from 1 to 100");
  }
  return parsed;
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

  let workItemIds: number[] | undefined;
  let range;
  let maxItems: number | undefined;
  try {
    workItemIds = parseWorkItemIds(body.work_item_ids);
    range = parseRange(body);
    maxItems = parseMaxItems(body.max_items);
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Invalid assessment request" },
      { status: 400 },
    );
  }

  try {
    const apps = filterAppsForUser(user, dal.getApps());
    const result = await runOutcomeEvidenceAssessment({
      apps,
      workItemIds,
      rangeDays: range.rangeStart ? null : range.rangeDays,
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
      maxItems,
      force: body.force === true,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Outcome evidence assessment failed" },
      { status: 500 },
    );
  }
}
