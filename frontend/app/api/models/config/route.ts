import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";
import {
  getChatModel, getChatProvider,
  getBackgroundModel, getBackgroundProvider,
  getQuickModel, getQuickProvider,
  getDemoModel, getDemoProvider,
} from "@/lib/server/config";
import { getAllModels } from "@/lib/server/agent";

export async function GET(request: NextRequest) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  return NextResponse.json({
    chatModel: getChatModel(),
    chatProvider: getChatProvider(),
    backgroundModel: getBackgroundModel(),
    backgroundProvider: getBackgroundProvider(),
    quickModel: getQuickModel(),
    quickProvider: getQuickProvider(),
    demoModel: getDemoModel(),
    demoProvider: getDemoProvider(),
    availableModels: getAllModels(),
    // Legacy compat
    defaultModel: getChatModel(),
    defaultProvider: getChatProvider(),
  });
}

// Setting key mapping
const SETTING_KEYS: Record<string, string> = {
  chatModel: "chat_model",
  chatProvider: "chat_provider",
  backgroundModel: "background_model",
  backgroundProvider: "background_provider",
  quickModel: "quick_model",
  quickProvider: "quick_provider",
  demoModel: "demo_model",
  demoProvider: "demo_provider",
  // Legacy compat
  defaultModel: "chat_model",
  defaultProvider: "chat_provider",
};

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

  // Save any provided keys
  for (const [bodyKey, dbKey] of Object.entries(SETTING_KEYS)) {
    if (body[bodyKey] && typeof body[bodyKey] === "string") {
      dal.setSetting(dbKey, body[bodyKey]);
    }
  }

  return NextResponse.json({
    chatModel: getChatModel(),
    chatProvider: getChatProvider(),
    backgroundModel: getBackgroundModel(),
    backgroundProvider: getBackgroundProvider(),
    quickModel: getQuickModel(),
    quickProvider: getQuickProvider(),
    demoModel: getDemoModel(),
    demoProvider: getDemoProvider(),
  });
}
