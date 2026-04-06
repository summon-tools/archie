import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { getGitConfig, getSshPublicKey } from "@/lib/server/git";
import { MODE } from "@/lib/server/config";
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

  const needsSetup = access.type !== "requires_auth";

  const gitConfig = getGitConfig();
  const sshPub = getSshPublicKey();

  return NextResponse.json({
    needs_setup: needsSetup,
    mode: MODE,
    default_projects_dir: path.join(os.homedir(), "Projects"),
    git_name: gitConfig.name,
    git_email: gitConfig.email,
    has_ssh_key: sshPub !== null,
    ssh_public_key: sshPub || "",
  });
}
