import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  const { appId } = await params;
  const id = Number(appId);

  const app = dal.getApp(id);
  if (!app) {
    return NextResponse.json({ detail: "App not found" }, { status: 404 });
  }

  dal.deleteAppToolConfig(id, "seed");

  return NextResponse.json({ message: "Seed script cleared" });
}
