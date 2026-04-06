import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { automationDefinitions, getAutomationDefinition } from "@/lib/server/automations/registry";

/**
 * GET /api/apps/{appId}/automations — list automation configs for an app.
 * Merges registered definitions with per-app config from the database.
 */
export async function GET(
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

    const configs = dal.getAutomationConfigsForApp(Number(appId));
    const configMap = new Map(configs.map((c) => [c.automation_key, c]));

    const automations = automationDefinitions.map((def) => {
      const config = configMap.get(def.key);
      return {
        key: def.key,
        name: def.name,
        description: def.description,
        defaultCron: def.defaultCron,
        enabled: config ? config.enabled === 1 : def.defaultEnabled,
        cronExpression: config?.cron_expression || def.defaultCron,
        lastRunAt: config?.last_run_at || null,
      };
    });

    return NextResponse.json({
      automations,
      project_owner_user_id: app.project_owner_user_id ?? null,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

/**
 * PUT /api/apps/{appId}/automations — update automation config or project owner.
 * Body: { key: string, enabled?: boolean, cron_expression?: string }
 *   OR: { project_owner_user_id: number | null }
 */
export async function PUT(
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
    const { key, enabled, cron_expression, project_owner_user_id } = body;

    // Handle project owner update (separate from automation config)
    if (project_owner_user_id !== undefined && !key) {
      // Validate the user exists and is active (null clears the owner)
      if (project_owner_user_id !== null) {
        const owner = dal.getUser(project_owner_user_id);
        if (!owner || owner.deleted_at) {
          return NextResponse.json({ detail: "User not found or deleted" }, { status: 400 });
        }
      }
      dal.updateApp(Number(appId), { project_owner_user_id: project_owner_user_id });
      return NextResponse.json({ project_owner_user_id });
    }

    if (!key || typeof key !== "string") {
      return NextResponse.json({ detail: "automation key is required" }, { status: 400 });
    }

    // Validate the key is a registered automation
    if (!getAutomationDefinition(key)) {
      return NextResponse.json({ detail: `Unknown automation key: ${key}` }, { status: 400 });
    }

    // Validate cron expression if provided.
    // Scheduler supports: hour (field 1) and optional day-of-week (field 4).
    // Fields 0 (min), 2 (dom), 3 (month) must be '*' — they are not evaluated.
    if (cron_expression !== undefined && cron_expression !== null) {
      const parts = String(cron_expression).trim().split(/\s+/);
      if (parts.length !== 5) {
        return NextResponse.json({ detail: "cron_expression must have 5 fields (min hour dom month dow)" }, { status: 400 });
      }
      const [min, hourStr, dom, month, dow] = parts;
      if (min !== "*" && min !== "0") {
        return NextResponse.json({ detail: "cron minute field must be '*' or '0' (sub-hour scheduling not supported)" }, { status: 400 });
      }
      if (dom !== "*") {
        return NextResponse.json({ detail: "cron day-of-month field must be '*' (dom scheduling not supported)" }, { status: 400 });
      }
      if (month !== "*") {
        return NextResponse.json({ detail: "cron month field must be '*' (month scheduling not supported)" }, { status: 400 });
      }
      const hour = parseInt(hourStr, 10);
      if (isNaN(hour) || hour < 0 || hour > 23) {
        return NextResponse.json({ detail: "cron hour must be 0-23" }, { status: 400 });
      }
      if (dow !== "*") {
        const dowNum = parseInt(dow, 10);
        if (isNaN(dowNum) || dowNum < 0 || dowNum > 7) {
          return NextResponse.json({ detail: "cron day-of-week must be '*' or 0-7 (0/7=Sun)" }, { status: 400 });
        }
      }
    }

    const fields: { enabled?: number; cronExpression?: string | null } = {};
    if (typeof enabled === "boolean") fields.enabled = enabled ? 1 : 0;
    if (cron_expression !== undefined) fields.cronExpression = cron_expression;

    dal.upsertAutomationConfig(Number(appId), key, fields);
    const updated = dal.getAutomationConfig(Number(appId), key);

    return NextResponse.json({ config: updated });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
