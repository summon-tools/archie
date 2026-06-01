import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import {
  getOutcomesGitHubSyncSettings,
  updateOutcomesGitHubSyncSettings,
} from "@/lib/server/outcomes-github-sync";

export async function GET(request: NextRequest) {
  try {
    await getAuthUser(request);
    return NextResponse.json({ settings: getOutcomesGitHubSyncSettings() });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ detail: error.message }, { status: 401 });
    }
    throw error;
  }
}

export async function PUT(request: NextRequest) {
  try {
    await getAuthUser(request);
    const body = await request.json().catch(() => ({}));
    const observationWindowDays = body.observation_window_days === undefined
      ? undefined
      : Number(body.observation_window_days);
    if (
      observationWindowDays !== undefined &&
      (!Number.isInteger(observationWindowDays) || observationWindowDays < 1 || observationWindowDays > 365)
    ) {
      return NextResponse.json({ detail: "observation_window_days must be an integer from 1 to 365" }, { status: 400 });
    }

    const dailySyncHour = body.daily_sync_hour_utc === undefined
      ? undefined
      : Number(body.daily_sync_hour_utc);
    if (
      dailySyncHour !== undefined &&
      (!Number.isInteger(dailySyncHour) || dailySyncHour < 0 || dailySyncHour > 23)
    ) {
      return NextResponse.json({ detail: "daily_sync_hour_utc must be an integer from 0 to 23" }, { status: 400 });
    }

    const settings = updateOutcomesGitHubSyncSettings({
      observation_window_days: observationWindowDays,
      daily_sync_enabled: body.daily_sync_enabled === undefined ? undefined : Boolean(body.daily_sync_enabled),
      daily_sync_hour_utc: dailySyncHour,
    });
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ detail: error.message }, { status: 401 });
    }
    throw error;
  }
}
