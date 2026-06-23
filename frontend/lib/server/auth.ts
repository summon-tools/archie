import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { AUTH_SECRET_KEY, MODE, FORCE_SECURE_COOKIES } from "./config";
import type { UserRole, UserRow } from "./types";
import { logger } from "./logger";

// Resolve JWT secret
let SECRET_KEY: string;
if (AUTH_SECRET_KEY) {
  SECRET_KEY = AUTH_SECRET_KEY;
} else if (MODE === "development") {
  SECRET_KEY = "dev-only-insecure-key";
  logger.warn("Using insecure dev JWT key. Set AUTH_SECRET_KEY for production.");
} else {
  throw new Error(
    "AUTH_SECRET_KEY environment variable is required. " +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

const ALGORITHM = "HS256";
const TOKEN_EXPIRE_HOURS = 72; // 3 days
export const COOKIE_NAME = "session_token";

const secretKey = new TextEncoder().encode(SECRET_KEY);

export function verifyPassword(
  plainPassword: string,
  hashedPassword: string
): boolean {
  return bcrypt.compareSync(plainPassword, hashedPassword);
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export async function createToken(
  userId: number,
  name: string,
  role: UserRole = "member"
): Promise<string> {
  const expire = new Date();
  expire.setHours(expire.getHours() + TOKEN_EXPIRE_HOURS);

  return new SignJWT({ sub: String(userId), name, role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setExpirationTime(expire)
    .sign(secretKey);
}

export async function decodeToken(
  token: string
): Promise<{ sub: string; name: string; role?: UserRole } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [ALGORITHM],
    });
    return payload as { sub: string; name: string; role?: UserRole };
  } catch {
    return null;
  }
}

export async function getAuthUser(
  request: NextRequest
): Promise<{ id: number; name: string; email: string; role: UserRole; color: string | null }> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    throw new AuthError("Not authenticated");
  }
  return getAuthUserFromToken(token);
}

export async function getAuthUserFromToken(
  token: string | null | undefined,
): Promise<{ id: number; name: string; email: string; role: UserRole; color: string | null }> {
  if (!token) {
    throw new AuthError("Not authenticated");
  }
  const payload = await decodeToken(token);
  if (!payload) {
    throw new AuthError("Invalid or expired token");
  }

  // Always verify role, name, and email from DB
  let role: UserRole = payload.role || "member";
  let name = payload.name || (payload as any).username || "";
  let email = "";
  let color: string | null = null;
  let dbUser: { name: string; role: UserRole; email: string | null; color: string | null; deleted_at: string | null } | undefined;
  try {
    const { getDb } = await import("./db");
    const db = getDb();
    dbUser = db
      .prepare("SELECT name, role, email, color, deleted_at FROM users WHERE id = ?")
      .get(parseInt(payload.sub, 10)) as typeof dbUser;
  } catch {
    // If DB lookup fails, fall through to use token values
  }
  if (dbUser) {
    if (dbUser.deleted_at) {
      throw new AuthError("Account has been deactivated");
    }
    role = dbUser.role;
    name = dbUser.name || name;
    email = dbUser.email || "";
    color = dbUser.color;
  }

  return { id: parseInt(payload.sub, 10), name, email, role, color };
}

export async function requireAdmin(
  request: NextRequest
): Promise<{ id: number; name: string; email: string; role: UserRole; color: string | null }> {
  const user = await getAuthUser(request);
  if (user.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
  return user;
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function isSecureRequest(request: Pick<NextRequest, "headers">): boolean {
  return (
    request.headers.get("x-forwarded-proto") === "https" ||
    FORCE_SECURE_COOKIES
  );
}

export function buildCookieOptions(isSecure: boolean) {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecure,
    maxAge: TOKEN_EXPIRE_HOURS * 3600,
    path: "/",
  };
}
