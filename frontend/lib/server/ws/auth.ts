import { IncomingMessage } from "http";
import { URL } from "url";
import { decodeToken } from "../auth";
import { getDb } from "../db";
import type { UserRow } from "../types";

export interface WsAuthUser {
  id: number;
  name: string;
  role: string;
}

/**
 * Authenticate a WebSocket upgrade request by extracting the JWT
 * from the `token` query parameter.
 *
 * Cookies don't cross ports, so the client passes the JWT as a query param.
 */
export async function authenticateWsUpgrade(
  request: IncomingMessage
): Promise<WsAuthUser | null> {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const token = url.searchParams.get("token");
    if (!token) return null;

    const payload = await decodeToken(token);
    if (!payload || !payload.sub) return null;

    const userId = parseInt(String(payload.sub), 10);
    if (isNaN(userId)) return null;

    // Verify user still exists and is active
    const db = getDb();
    const user = db
      .prepare("SELECT id, name, role, deleted_at FROM users WHERE id = ?")
      .get(userId) as Pick<UserRow, "id" | "name" | "role" | "deleted_at"> | undefined;

    if (!user || user.deleted_at) return null;

    return { id: user.id, name: user.name, role: user.role };
  } catch {
    return null;
  }
}
