import crypto from "crypto";
import { NextRequest } from "next/server";
import * as dal from "@/lib/server/dal";
import { decryptSecret, encryptSecret } from "./secret-box";
import type { GitHubUserConnectionRow } from "./types";

export const GITHUB_OAUTH_CALLBACK_SUFFIX = "/api/github/oauth/callback";
const GITHUB_API_VERSION = "2022-11-28";
const REFRESH_SKEW_MS = 2 * 60 * 1000;

export class GitHubAppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "GitHubAppError";
  }
}

export interface GitHubAppSettings {
  public_server_url: string;
  client_id: string;
  client_secret: string;
  app_slug: string;
  install_url: string;
  bot_username: string;
  bot_display_name: string;
  bot_email: string;
}

export interface PublicGitHubAppSettings {
  public_server_url: string;
  callback_suffix: string;
  callback_url: string;
  client_id: string;
  client_secret_configured: boolean;
  app_slug: string;
  install_url: string;
  bot_username: string;
  bot_display_name: string;
  bot_email: string;
}

function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function requestOrigin(request: Pick<NextRequest, "headers" | "url">): string {
  const configured = dal.getSetting("public_server_url");
  if (configured) return normalizeServerUrl(configured);

  const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

export function getGitHubAppSettings(): GitHubAppSettings {
  return {
    public_server_url: dal.getSetting("public_server_url") || "",
    client_id: dal.getSetting("github_app_client_id") || "",
    client_secret: decryptSecret(dal.getSetting("github_app_client_secret")),
    app_slug: dal.getSetting("github_app_slug") || "",
    install_url: dal.getSetting("github_app_install_url") || "",
    bot_username: dal.getSetting("github_bot_username") || "",
    bot_display_name: dal.getSetting("github_bot_display_name") || "Archie",
    bot_email: dal.getSetting("github_bot_email") || "",
  };
}

export function getPublicGitHubAppSettings(request?: Pick<NextRequest, "headers" | "url">): PublicGitHubAppSettings {
  const settings = getGitHubAppSettings();
  const publicServerUrl = settings.public_server_url || (request ? requestOrigin(request) : "");
  const normalizedServerUrl = publicServerUrl ? normalizeServerUrl(publicServerUrl) : "";
  return {
    public_server_url: settings.public_server_url,
    callback_suffix: GITHUB_OAUTH_CALLBACK_SUFFIX,
    callback_url: normalizedServerUrl ? `${normalizedServerUrl}${GITHUB_OAUTH_CALLBACK_SUFFIX}` : GITHUB_OAUTH_CALLBACK_SUFFIX,
    client_id: settings.client_id,
    client_secret_configured: Boolean(settings.client_secret),
    app_slug: settings.app_slug,
    install_url: settings.install_url,
    bot_username: settings.bot_username,
    bot_display_name: settings.bot_display_name,
    bot_email: settings.bot_email,
  };
}

export function updateGitHubAppSettings(input: Partial<GitHubAppSettings> & { clear_client_secret?: boolean }): void {
  const simpleKeys: Array<[keyof GitHubAppSettings, string]> = [
    ["public_server_url", "public_server_url"],
    ["client_id", "github_app_client_id"],
    ["app_slug", "github_app_slug"],
    ["install_url", "github_app_install_url"],
    ["bot_username", "github_bot_username"],
    ["bot_display_name", "github_bot_display_name"],
    ["bot_email", "github_bot_email"],
  ];

  for (const [field, key] of simpleKeys) {
    if (input[field] !== undefined) {
      const value = field === "public_server_url" ? normalizeServerUrl(String(input[field] || "")) : String(input[field] || "").trim();
      dal.setSetting(key, value);
    }
  }

  if (input.clear_client_secret) {
    dal.deleteSetting("github_app_client_secret");
  } else if (input.client_secret !== undefined && input.client_secret.trim()) {
    dal.setSetting("github_app_client_secret", encryptSecret(input.client_secret.trim()));
  }
}

export function getOAuthCallbackUrl(request: Pick<NextRequest, "headers" | "url">): string {
  return `${requestOrigin(request)}${GITHUB_OAUTH_CALLBACK_SUFFIX}`;
}

export function assertGitHubAppConfigured(request?: Pick<NextRequest, "headers" | "url">): GitHubAppSettings & { callback_url: string } {
  const settings = getGitHubAppSettings();
  const callbackUrl = request ? getOAuthCallbackUrl(request) : "";
  if (!settings.client_id) {
    throw new GitHubAppError("github_app_not_configured", "GitHub App client ID is not configured.");
  }
  if (!settings.client_secret) {
    throw new GitHubAppError("github_app_not_configured", "GitHub App client secret is not configured.");
  }
  return { ...settings, callback_url: callbackUrl };
}

export function buildOAuthAuthorizeUrl({
  request,
  state,
  codeChallenge,
}: {
  request: Pick<NextRequest, "headers" | "url">;
  state: string;
  codeChallenge: string;
}): string {
  const settings = assertGitHubAppConfigured(request);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", settings.client_id);
  url.searchParams.set("redirect_uri", settings.callback_url);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function generateOAuthVerifier(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function isoFromNow(seconds?: number): string | null {
  if (!seconds) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function exchangeOAuthToken(params: Record<string, string>): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !data.access_token) {
    throw new GitHubAppError(
      "github_oauth_exchange_failed",
      data.error_description || data.error || `GitHub OAuth exchange failed (${res.status})`,
      502,
    );
  }
  return data;
}

export async function completeOAuthConnection({
  request,
  userId,
  code,
  codeVerifier,
}: {
  request: Pick<NextRequest, "headers" | "url">;
  userId: number;
  code: string;
  codeVerifier: string;
}): Promise<GitHubUserConnectionRow> {
  const settings = assertGitHubAppConfigured(request);
  const tokenData = await exchangeOAuthToken({
    client_id: settings.client_id,
    client_secret: settings.client_secret,
    code,
    redirect_uri: settings.callback_url,
    code_verifier: codeVerifier,
  });

  const profile = await getGitHubUserProfile(tokenData.access_token);
  return dal.upsertGitHubUserConnection({
    user_id: userId,
    github_user_id: profile.id,
    github_login: profile.login,
    github_name: profile.name || null,
    github_email: profile.email || `${profile.id}+${profile.login}@users.noreply.github.com`,
    access_token_ciphertext: encryptSecret(tokenData.access_token),
    refresh_token_ciphertext: tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : null,
    access_token_expires_at: isoFromNow(tokenData.expires_in),
    refresh_token_expires_at: isoFromNow(tokenData.refresh_token_expires_in),
  });
}

async function getGitHubUserProfile(token: string): Promise<{ id: number; login: string; name: string | null; email: string | null }> {
  const res = await fetch("https://api.github.com/user", {
    headers: githubApiHeaders(token),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GitHubAppError("github_profile_failed", data.message || `GitHub profile lookup failed (${res.status})`, 502);
  }
  return {
    id: data.id,
    login: data.login,
    name: data.name || null,
    email: data.email || null,
  };
}

export function githubApiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

export function githubAuthorFromConnection(
  connection: GitHubUserConnectionRow,
  fallbackName: string,
): { name: string; email: string; login: string } {
  const login = connection.github_login;
  const name = connection.github_name || fallbackName || login;
  const email = connection.github_email || `${connection.github_user_id}+${login}@users.noreply.github.com`;
  return { name, email, login };
}

export function getArchieCoAuthor(): { name: string; email: string } | null {
  const settings = getGitHubAppSettings();
  if (!settings.bot_email.trim()) return null;
  return {
    name: settings.bot_display_name.trim() || settings.bot_username.trim() || "Archie",
    email: settings.bot_email.trim(),
  };
}

function tokenNeedsRefresh(connection: GitHubUserConnectionRow): boolean {
  if (!connection.access_token_expires_at) return false;
  const expiresAt = Date.parse(connection.access_token_expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now() + REFRESH_SKEW_MS;
}

export async function getValidGitHubUserToken(userId: number): Promise<{
  token: string;
  connection: GitHubUserConnectionRow;
}> {
  const connection = dal.getGitHubUserConnection(userId);
  if (!connection) {
    throw new GitHubAppError("github_user_not_connected", "Connect your GitHub account before publishing.");
  }

  if (!tokenNeedsRefresh(connection)) {
    return { token: decryptSecret(connection.access_token_ciphertext), connection };
  }

  if (!connection.refresh_token_ciphertext) {
    throw new GitHubAppError("github_user_reconnect_required", "GitHub authorization expired. Reconnect your GitHub account.");
  }

  const settings = assertGitHubAppConfigured();
  const tokenData = await exchangeOAuthToken({
    client_id: settings.client_id,
    client_secret: settings.client_secret,
    grant_type: "refresh_token",
    refresh_token: decryptSecret(connection.refresh_token_ciphertext),
  });

  dal.updateGitHubUserConnectionTokens(userId, {
    access_token_ciphertext: encryptSecret(tokenData.access_token),
    refresh_token_ciphertext: tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : connection.refresh_token_ciphertext,
    access_token_expires_at: isoFromNow(tokenData.expires_in),
    refresh_token_expires_at: tokenData.refresh_token_expires_in
      ? isoFromNow(tokenData.refresh_token_expires_in)
      : connection.refresh_token_expires_at,
  });

  const refreshed = dal.getGitHubUserConnection(userId)!;
  return { token: tokenData.access_token, connection: refreshed };
}
