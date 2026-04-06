import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { getAutomationDefinition } from "@/lib/server/automations/registry";
import { runAutomation } from "@/lib/server/automations/runner";

/**
 * POST /api/apps/{appId}/automations/run — trigger an automation run immediately.
 * Body: { key: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const body = await request.json();
    const { key } = body;

    if (!key || typeof key !== "string") {
      return NextResponse.json({ detail: "automation key is required" }, { status: 400 });
    }

    const definition = getAutomationDefinition(key);
    if (!definition) {
      return NextResponse.json({ detail: "Unknown automation key" }, { status: 404 });
    }

    // Check for already-running
    const existing = dal.getActiveRunByWorkflow(Number(appId), `automation:${key}`);
    if (existing) {
      return NextResponse.json({ detail: "Automation is already running" }, { status: 409 });
    }

    // Fire and forget — the run will appear in jobs/active
    runAutomation(Number(appId), key, { manual: true }).catch(() => {});

    return NextResponse.json({ message: `Automation ${definition.name} triggered` });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
