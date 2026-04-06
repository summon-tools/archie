import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default function proxy(request: NextRequest) {
  const sessionToken = request.cookies.get("session_token");
  const { pathname } = request.nextUrl;

  // Allow access to login page, static assets, and API routes
  if (
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // No session cookie → redirect to login
  if (!sessionToken) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
