import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { recomputeOutcomeSnapshots } from "@/lib/server/outcome-snapshots";
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
  try {
    workItemIds = parseWorkItemIds(body.work_item_ids);
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Invalid recompute request" },
      { status: 400 },
    );
  }

  const apps = filterAppsForUser(user, dal.getApps());
  const result = recomputeOutcomeSnapshots({ apps, workItemIds });
  return NextResponse.json({
    recomputed_count: result.recomputed_count,
    snapshot_ids: result.snapshots.map((snapshot) => snapshot.id),
    generated_at: result.generated_at,
  });
}
