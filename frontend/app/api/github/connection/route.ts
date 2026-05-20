import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

function serializeConnection(userId: number) {
  const connection = dal.getGitHubUserConnection(userId);
  if (!connection) return { connected: false };
  return {
    connected: true,
    github_login: connection.github_login,
    github_name: connection.github_name,
    github_email: connection.github_email,
    access_token_expires_at: connection.access_token_expires_at,
    refresh_token_expires_at: connection.refresh_token_expires_at,
    connected_at: connection.connected_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    return NextResponse.json(serializeConnection(user.id));
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    dal.revokeGitHubUserConnection(user.id);
    return NextResponse.json({ connected: false });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}
