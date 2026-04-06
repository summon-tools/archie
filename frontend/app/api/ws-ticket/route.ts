import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError, createToken } from "@/lib/server/auth";

/**
 * GET /api/ws-ticket
 *
 * Returns a short-lived JWT that the client can pass to the WebSocket server.
 * The session cookie is httpOnly so JavaScript can't read it — this endpoint
 * bridges that gap by issuing a WS-specific token authenticated via the cookie.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    // Create a short-lived token (reuses the same createToken, the WS server
    // validates it with the same secret)
    const token = await createToken(user.id, user.name, user.role);
    return NextResponse.json({ token });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
