import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import {
  createMcpToken,
  normalizeAllowedAppIds,
  normalizeScopes,
} from "@/lib/server/mcp/auth";
import { handleRoomRouteError, readJsonBody, RouteInputError } from "@/lib/server/room-route-utils";

function serializeToken(token: dal.McpTokenRecord) {
  return {
    id: token.id,
    name: token.name,
    token_prefix: token.token_prefix,
    created_by_user_id: token.created_by_user_id,
    created_by_user_name: token.created_by_user_name,
    scopes: token.scopes,
    allowed_app_ids: token.allowed_app_ids,
    last_used_at: token.last_used_at,
    expires_at: token.expires_at,
    revoked_at: token.revoked_at,
    created_at: token.created_at,
    updated_at: token.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json({
      tokens: dal.listMcpTokens().map(serializeToken),
    });
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RouteInputError("Token payload is required");
    }
    const input = body as Record<string, unknown>;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) throw new RouteInputError("name is required");

    const scopes = normalizeScopes(input.scopes);
    if (scopes.length === 0) throw new RouteInputError("At least one valid scope is required");

    const allowedAppIds = normalizeAllowedAppIds(input.allowed_app_ids);
    for (const appId of allowedAppIds) {
      if (!dal.getApp(appId)) throw new RouteInputError(`Unknown app id: ${appId}`);
    }

    const expiresAt = typeof input.expires_at === "string" && input.expires_at.trim()
      ? input.expires_at.trim()
      : null;
    const { token, secret } = createMcpToken({
      name,
      scopes,
      allowedAppIds,
      expiresAt,
      createdByUserId: user.id,
    });

    return NextResponse.json({
      token: serializeToken(token),
      secret,
    }, { status: 201 });
  } catch (error) {
    const errorResponse = handleRoomRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
