import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";
import {
  getPublicGitHubAppSettings,
  updateGitHubAppSettings,
} from "@/lib/server/github-app";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ detail: e.message }, { status: 403 });
    throw e;
  }

  return NextResponse.json(getPublicGitHubAppSettings(request));
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ detail: e.message }, { status: 403 });
    throw e;
  }

  const body = await request.json().catch(() => ({}));
  updateGitHubAppSettings({
    public_server_url: typeof body.public_server_url === "string" ? body.public_server_url : undefined,
    app_id: typeof body.app_id === "string" ? body.app_id : undefined,
    private_key: typeof body.private_key === "string" ? body.private_key : undefined,
    client_id: typeof body.client_id === "string" ? body.client_id : undefined,
    client_secret: typeof body.client_secret === "string" ? body.client_secret : undefined,
    app_slug: typeof body.app_slug === "string" ? body.app_slug : undefined,
    install_url: typeof body.install_url === "string" ? body.install_url : undefined,
    bot_username: typeof body.bot_username === "string" ? body.bot_username : undefined,
    bot_display_name: typeof body.bot_display_name === "string" ? body.bot_display_name : undefined,
    bot_email: typeof body.bot_email === "string" ? body.bot_email : undefined,
    webhook_secret: typeof body.webhook_secret === "string" ? body.webhook_secret : undefined,
    clear_client_secret: body.clear_client_secret === true,
    clear_private_key: body.clear_private_key === true,
    clear_webhook_secret: body.clear_webhook_secret === true,
  });

  return NextResponse.json(getPublicGitHubAppSettings(request));
}
