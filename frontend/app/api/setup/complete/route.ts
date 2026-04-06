import { NextRequest, NextResponse } from "next/server";
import { setupCompleteSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";
import {
  completeInitialSetup,
  getSetupAccess,
  getSetupAccessErrorMessage,
} from "@/lib/server/setup";

export async function POST(request: NextRequest) {
  const access = getSetupAccess();
  if (access.type === "requires_auth") {
    return NextResponse.json({ detail: "Setup already completed" }, { status: 403 });
  }
  if (access.type === "needs_setup_blocked") {
    return NextResponse.json({ detail: getSetupAccessErrorMessage() }, { status: 403 });
  }

  const body = await request.json();
  const parsed = setupCompleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: formatZodError(parsed.error) },
      { status: 400 }
    );
  }
  try {
    const { token, cookieOpts, responseBody } = await completeInitialSetup(
      request,
      parsed.data,
    );

    const response = NextResponse.json(responseBody);
    response.cookies.set(cookieOpts.name, token, {
      httpOnly: cookieOpts.httpOnly,
      sameSite: cookieOpts.sameSite,
      secure: cookieOpts.secure,
      maxAge: cookieOpts.maxAge,
      path: cookieOpts.path,
    });
    return response;
  } catch (e) {
    return NextResponse.json(
      { detail: e instanceof Error ? e.message : "Setup failed" },
      { status: 400 }
    );
  }
}
