import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser, isSecureRequest } from "@/lib/server/auth";
import { completeOAuthConnection, getPublicServerOrigin, GitHubAppError } from "@/lib/server/github-app";

const STATE_COOKIE = "github_oauth_state";
const VERIFIER_COOKIE = "github_oauth_verifier";
const USER_COOKIE = "github_oauth_user";

function profileRedirect(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/profile", getPublicServerOrigin(request));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  const secure = isSecureRequest(request);
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE, USER_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthUser>>;
  try {
    user = await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.redirect(new URL("/login", getPublicServerOrigin(request)));
    }
    throw e;
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return profileRedirect(request, {
      github: "error",
      message: url.searchParams.get("error_description") || error,
    });
  }

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const expectedState = request.cookies.get(STATE_COOKIE)?.value || "";
  const verifier = request.cookies.get(VERIFIER_COOKIE)?.value || "";
  const expectedUserId = request.cookies.get(USER_COOKIE)?.value || "";

  if (!code || !state || !expectedState || state !== expectedState || expectedUserId !== String(user.id)) {
    return profileRedirect(request, {
      github: "error",
      message: "GitHub authorization state could not be verified. Try connecting again.",
    });
  }

  try {
    await completeOAuthConnection({
      request,
      userId: user.id,
      code,
      codeVerifier: verifier,
    });
    return profileRedirect(request, { github: "connected" });
  } catch (e) {
    if (e instanceof GitHubAppError) {
      return profileRedirect(request, { github: "error", message: e.message });
    }
    throw e;
  }
}
