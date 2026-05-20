import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import * as dal from "@/lib/server/dal";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";
import { getProjectsDir, clearSettingsCache } from "@/lib/server/config";
import { clearProviderCache } from "@/lib/server/knowledge/preflight";
import { createSettingSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

function findClaudeBin(): string {
  try {
    return execSync("which claude", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ detail: e.message }, { status: 403 });
    }
    throw e;
  }

  const allSettings = dal.getAllSettings();

  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(allSettings)) {
    if (key === "github_app_client_secret" && value) {
      settings[key] = "configured";
    } else if (key === "github_token" && value) {
      // Mask token: show prefix + last 4 chars
      const v = value;
      const prefix = v.startsWith("ghp_") ? "ghp_" : v.startsWith("github_pat_") ? "github_pat_" : "";
      const lastFour = v.slice(-4);
      settings[key] = prefix + "xxxx..." + lastFour;
    } else {
      settings[key] = value;
    }
  }

  return NextResponse.json({
    settings,
    computed: {
      projects_dir: getProjectsDir(),
      claude_bin: findClaudeBin(),
      home_dir: os.homedir(),
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ detail: e.message }, { status: 403 });
    }
    throw e;
  }

  const body = await request.json();
  const parsed = createSettingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: formatZodError(parsed.error) },
      { status: 400 }
    );
  }
  const { key, value } = parsed.data;

  dal.setSetting(key, value);
  clearSettingsCache();
  clearProviderCache();

  return NextResponse.json({ key, value });
}
