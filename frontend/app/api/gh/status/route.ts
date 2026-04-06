import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { ghIsInstalled, ghAuthStatus } from "@/lib/server/gh";
import {
  getSetupAccess,
  getSetupAccessErrorMessage,
} from "@/lib/server/setup";

export async function GET(request: NextRequest) {
  const access = getSetupAccess();
  if (access.type === "needs_setup_blocked") {
    return NextResponse.json({ detail: getSetupAccessErrorMessage() }, { status: 403 });
  }
  if (access.type === "requires_auth") {
    try {
      await getAuthUser(request);
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ detail: e.message }, { status: 401 });
      }
      throw e;
    }
  }

  const installed = ghIsInstalled();
  if (!installed) {
    return NextResponse.json({
      installed: false,
      authenticated: false,
      user: null,
      host: null,
    });
  }

  const auth = ghAuthStatus();
  return NextResponse.json({
    installed: true,
    authenticated: auth.authenticated,
    user: auth.user,
    host: auth.host,
  });
}
