import fs from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { getDb } from "./db";
import * as dal from "./dal";
import {
  hashPassword,
  createToken,
  isSecureRequest,
  buildCookieOptions,
} from "./auth";
import { setGitConfig, setupSshKey } from "./git";
import { randomAvatarColor } from "./avatarColors";
import { MODE } from "./config";
import { setupCompleteSchema } from "../schemas/api";
import type { z } from "zod";

export type SetupCompleteInput = z.infer<typeof setupCompleteSchema>;

const AUTOMATION_USERNAME = "__archie_automation__";

export function needsInitialSetup(): boolean {
  const db = getDb();
  const { cnt } = db
    .prepare("SELECT COUNT(*) as cnt FROM users WHERE username != ?")
    .get(AUTOMATION_USERNAME) as { cnt: number };
  return cnt === 0;
}

/**
 * Returns how this request should be authorized for setup-gated endpoints.
 *
 * - "open"                 — no auth required (dev mode during initial setup)
 * - "needs_setup_blocked"  — initial setup not yet complete (production blocks web UI setup)
 * - "requires_auth"        — setup complete; caller must run normal JWT auth
 *
 * In production, initial setup is done by the install script (bootstrap-admin.js) before
 * the app is exposed, so the web UI setup flow is only reachable in development mode.
 */
export type SetupAccess =
  | { type: "open" }
  | { type: "needs_setup_blocked" }
  | { type: "requires_auth" };

export function getSetupAccess(): SetupAccess {
  if (!needsInitialSetup()) return { type: "requires_auth" };
  if (MODE !== "production") return { type: "open" };
  return { type: "needs_setup_blocked" };
}

export function getSetupAccessErrorMessage(): string {
  return MODE === "production"
    ? "Initial production setup must be completed from the server install script."
    : "Setup access denied.";
}

export async function completeInitialSetup(
  request: Pick<NextRequest, "headers">,
  data: SetupCompleteInput,
) {
  const { name, email, password, projects_dir, git_name, git_email, generate_ssh_key } = data;

  if (MODE !== "development") {
    if (!email) {
      throw new Error("Email is required");
    }
    if (!password) {
      throw new Error("Password is required");
    }
  }

  const db = getDb();

  const passwordHash = password ? hashPassword(password) : "";
  const userEmail = email || "local@archie.dev";
  const color = randomAvatarColor();

  // Wrap check + insert in a transaction to prevent concurrent setup requests
  // from creating duplicate admin accounts.
  let userId: number;
  const insert = db.transaction(() => {
    const { cnt } = db
      .prepare("SELECT COUNT(*) as cnt FROM users WHERE username != ?")
      .get(AUTOMATION_USERNAME) as { cnt: number };
    if (cnt > 0) throw new Error("Setup already completed");

    const result = db
      .prepare("INSERT INTO users (username, name, email, password_hash, role, color) VALUES (?, ?, ?, ?, 'admin', ?)")
      .run(name, name, userEmail, passwordHash, color);
    return result.lastInsertRowid as number;
  });

  userId = insert();

  const projDir = projects_dir || path.join(process.env.HOME || "", "Projects");
  fs.mkdirSync(projDir, { recursive: true });
  dal.setSetting("projects_dir", projDir);

  if (git_name || git_email) {
    setGitConfig(git_name || "", git_email || "");
  }

  let sshPublicKey = "";
  if (generate_ssh_key) {
    try {
      const sshResult = setupSshKey();
      if (sshResult.success) {
        sshPublicKey = sshResult.public_key;
      }
    } catch {
      // best effort
    }
  }

  const token = await createToken(userId, name, "admin");
  const secure = isSecureRequest(request);
  const cookieOpts = buildCookieOptions(secure);

  return {
    token,
    cookieOpts,
    responseBody: {
      message: "Setup complete",
      name,
      ssh_public_key: sshPublicKey,
    },
  };
}
