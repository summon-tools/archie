import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";
import {
  getGitConfig,
  setGitConfig,
  getSshPublicKey,
  getSshKeyPath,
} from "@/lib/server/git";
import { gitSettingsSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ detail: e.message }, { status: 403 });
    }
    throw e;
  }

  const gitConfig = getGitConfig();
  const sshKey = getSshPublicKey();
  const sshKeyPath = getSshKeyPath();

  return NextResponse.json({
    name: gitConfig.name,
    email: gitConfig.email,
    ssh_key: sshKey || "",
    ssh_key_path: sshKeyPath || "",
    has_ssh_key: sshKey !== null,
  });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ detail: e.message }, { status: 403 });
    }
    throw e;
  }

  const body = await request.json();
  const parsed = gitSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: formatZodError(parsed.error) },
      { status: 400 }
    );
  }
  const { name, email } = parsed.data;

  const result = setGitConfig(name || "", email || "");

  if (!result.success) {
    return NextResponse.json({ detail: result.message }, { status: 500 });
  }

  return NextResponse.json({ message: result.message });
}
