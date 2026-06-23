import crypto from "crypto";
import * as dal from "@/lib/server/dal";

export const MCP_TOKEN_PREFIX = "archie_";

export const MCP_SCOPES = [
  "apps:read",
  "skills:read",
  "project:read",
  "tasks:read",
  "tasks:write",
  "tasks:stop",
  "servers:read",
  "servers:start",
  "servers:stop",
  "activity:read",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export interface McpPrincipal {
  tokenId: number;
  name: string;
  scopes: Set<string>;
  allowedAppIds: Set<number>;
  createdByUserId: number | null;
}

export class McpAuthError extends Error {
  constructor(message = "Invalid or missing MCP token") {
    super(message);
    this.name = "McpAuthError";
  }
}

export class McpForbiddenError extends Error {
  constructor(message = "MCP token is not allowed to perform this action") {
    super(message);
    this.name = "McpForbiddenError";
  }
}

export function generateMcpTokenSecret(): string {
  return `${MCP_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashMcpTokenSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf-8").digest("hex");
}

export function tokenPrefix(secret: string): string {
  return secret.slice(0, 18);
}

export function normalizeScopes(value: unknown): McpScope[] {
  const source = Array.isArray(value) ? value : [];
  const allowed = new Set<string>(MCP_SCOPES);
  const result: McpScope[] = [];
  for (const item of source) {
    if (typeof item !== "string" || !allowed.has(item)) continue;
    if (!result.includes(item as McpScope)) result.push(item as McpScope);
  }
  return result;
}

export function normalizeAllowedAppIds(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [];
  const result: number[] = [];
  for (const item of source) {
    const n = typeof item === "number" ? item : Number(item);
    if (!Number.isInteger(n) || n <= 0) continue;
    if (!result.includes(n)) result.push(n);
  }
  return result;
}

export function createMcpToken(input: {
  name: string;
  scopes: string[];
  allowedAppIds?: number[];
  createdByUserId?: number | null;
  expiresAt?: string | null;
}): { token: dal.McpTokenRecord; secret: string } {
  const secret = generateMcpTokenSecret();
  const token = dal.createMcpToken({
    name: input.name.trim() || "MCP token",
    token_hash: hashMcpTokenSecret(secret),
    token_prefix: tokenPrefix(secret),
    created_by_user_id: input.createdByUserId ?? null,
    scopes: normalizeScopes(input.scopes),
    allowed_app_ids: normalizeAllowedAppIds(input.allowedAppIds ?? []),
    expires_at: input.expiresAt ?? null,
  });
  return { token, secret };
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

export function authenticateMcpBearerToken(authorization: string | null): McpPrincipal {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new McpAuthError();

  const secret = match[1].trim();
  if (!secret.startsWith(MCP_TOKEN_PREFIX)) throw new McpAuthError();

  const record = dal.getMcpTokenByHash(hashMcpTokenSecret(secret));
  if (!record || record.revoked_at || isExpired(record.expires_at)) {
    throw new McpAuthError();
  }

  dal.touchMcpToken(record.id);
  return {
    tokenId: record.id,
    name: record.name,
    scopes: new Set(record.scopes),
    allowedAppIds: new Set(record.allowed_app_ids),
    createdByUserId: record.created_by_user_id,
  };
}

export function requireMcpScope(principal: McpPrincipal, scope: McpScope): void {
  if (!principal.scopes.has(scope)) {
    throw new McpForbiddenError(`MCP token is missing required scope: ${scope}`);
  }
}

export function requireMcpAppAccess(principal: McpPrincipal, appId: number): void {
  if (principal.allowedAppIds.size > 0 && !principal.allowedAppIds.has(appId)) {
    throw new McpForbiddenError(`MCP token cannot access app ${appId}`);
  }
}

export function requireMcpAppScope(principal: McpPrincipal, appId: number, scope: McpScope): void {
  requireMcpScope(principal, scope);
  requireMcpAppAccess(principal, appId);
}
