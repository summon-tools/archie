import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import {
  verifyPassword,
  createToken,
  COOKIE_NAME,
  isSecureRequest,
  buildCookieOptions,
} from "@/lib/server/auth";
import type { UserRow } from "@/lib/server/types";
import { clearSettingsCache, MODE } from "@/lib/server/config";
import { clearProviderCache } from "@/lib/server/knowledge/preflight";
import { loginSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

// In-memory rate limiter
const loginAttempts = new Map<string, number[]>();

function checkRateLimit(ip: string, maxAttempts = 5, windowSec = 300) {
  const now = Date.now();
  const attempts = (loginAttempts.get(ip) || []).filter(
    (t) => now - t < windowSec * 1000
  );
  if (attempts.length >= maxAttempts) {
    return false;
  }
  attempts.push(now);
  loginAttempts.set(ip, attempts);
  return true;
}

export async function POST(request: NextRequest) {
  // Dev mode: auto-login as first active user, no password needed
  if (MODE === "development") {
    const db = getDb();
    const user = db
      .prepare("SELECT * FROM users WHERE deleted_at IS NULL AND username != '__archie_automation__' ORDER BY id LIMIT 1")
      .get() as UserRow | undefined;

    if (!user) {
      return NextResponse.json(
        { detail: "No user found. Please run setup first." },
        { status: 401 }
      );
    }

    clearSettingsCache();
    clearProviderCache();

    const token = await createToken(user.id, user.name, user.role);
    const secure = isSecureRequest(request);
    const cookieOpts = buildCookieOptions(secure);

    const response = NextResponse.json({
      message: "Login successful",
      name: user.name,
      email: user.email,
    });
    response.cookies.set(cookieOpts.name, token, {
      httpOnly: cookieOpts.httpOnly,
      sameSite: cookieOpts.sameSite,
      secure: cookieOpts.secure,
      maxAge: cookieOpts.maxAge,
      path: cookieOpts.path,
    });
    return response;
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { detail: "Too many login attempts. Try again later." },
      { status: 429 }
    );
  }

  const body = await request.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: formatZodError(parsed.error) },
      { status: 400 }
    );
  }
  const { email, password } = parsed.data;

  const db = getDb();
  const user = db
    .prepare("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL")
    .get(email) as UserRow | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json(
      { detail: "Invalid email or password" },
      { status: 401 }
    );
  }

  // Clear caches on login so fresh settings/provider state is picked up
  clearSettingsCache();
  clearProviderCache();

  const token = await createToken(user.id, user.name, user.role);
  const secure = isSecureRequest(request);
  const cookieOpts = buildCookieOptions(secure);

  const response = NextResponse.json({
    message: "Login successful",
    name: user.name,
    email: user.email,
  });
  response.cookies.set(cookieOpts.name, token, {
    httpOnly: cookieOpts.httpOnly,
    sameSite: cookieOpts.sameSite,
    secure: cookieOpts.secure,
    maxAge: cookieOpts.maxAge,
    path: cookieOpts.path,
  });
  return response;
}
