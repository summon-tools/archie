import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildCookieOptions,
  getAuthUser,
  AuthError,
  isSecureRequest,
} from "@/lib/server/auth";
import {
  buildOAuthAuthorizeUrl,
  generateOAuthVerifier,
  GitHubAppError,
} from "@/lib/server/github-app";

const STATE_COOKIE = "github_oauth_state";
const VERIFIER_COOKIE = "github_oauth_verifier";
const USER_COOKIE = "github_oauth_user";

export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthUser>>;
  try {
    user = await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    throw e;
  }

  try {
    const state = crypto.randomBytes(24).toString("base64url");
    const { verifier, challenge } = generateOAuthVerifier();
    const authorizeUrl = buildOAuthAuthorizeUrl({ request, state, codeChallenge: challenge });
    const response = NextResponse.redirect(authorizeUrl);
    const secure = isSecureRequest(request);
    const baseCookie = buildCookieOptions(secure);
    const cookieOptions = {
      httpOnly: true,
      sameSite: baseCookie.sameSite,
      secure: baseCookie.secure,
      path: "/",
      maxAge: 600,
    } as const;
    response.cookies.set(STATE_COOKIE, state, cookieOptions);
    response.cookies.set(VERIFIER_COOKIE, verifier, cookieOptions);
    response.cookies.set(USER_COOKIE, String(user.id), cookieOptions);
    return response;
  } catch (e) {
    if (e instanceof GitHubAppError) {
      const url = new URL("/profile", request.url);
      url.searchParams.set("github", "error");
      url.searchParams.set("message", e.message);
      return NextResponse.redirect(url);
    }
    throw e;
  }
}
