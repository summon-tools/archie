import crypto from "crypto";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import * as dal from "@/lib/server/dal";
import { getPublicServerOrigin, normalizeServerUrl } from "./public-url";
import { decryptSecret, encryptSecret } from "./secret-box";
import type { GitHubUserConnectionRow } from "./types";

export { getPublicServerOrigin } from "./public-url";

export const GITHUB_OAUTH_CALLBACK_SUFFIX = "/api/github/oauth/callback";
const GITHUB_API_VERSION = "2022-11-28";
const REFRESH_SKEW_MS = 2 * 60 * 1000;
const APP_JWT_LIFETIME_SECONDS = 9 * 60;

const installationTokenCache = new Map<string, { token: string; expiresAt: number }>();

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
  app_id: string;
  private_key: string;
  client_id: string;
  client_secret: string;
  app_slug: string;
  install_url: string;
  bot_username: string;
  bot_display_name: string;
  bot_email: string;
  webhook_secret: string;
}

export interface PublicGitHubAppSettings {
  public_server_url: string;
  app_id: string;
  private_key_configured: boolean;
  callback_suffix: string;
  callback_url: string;
  client_id: string;
  client_secret_configured: boolean;
  app_slug: string;
  install_url: string;
  bot_username: string;
  bot_display_name: string;
  bot_email: string;
  webhook_secret_configured: boolean;
}

export function getGitHubAppSettings(): GitHubAppSettings {
  return {
    public_server_url: dal.getSetting("public_server_url") || "",
    app_id: dal.getSetting("github_app_id") || "",
    private_key: decryptSecret(dal.getSetting("github_app_private_key")),
    client_id: dal.getSetting("github_app_client_id") || "",
    client_secret: decryptSecret(dal.getSetting("github_app_client_secret")),
    app_slug: dal.getSetting("github_app_slug") || "",
    install_url: dal.getSetting("github_app_install_url") || "",
    bot_username: dal.getSetting("github_bot_username") || "",
    bot_display_name: dal.getSetting("github_bot_display_name") || "Archie",
    bot_email: dal.getSetting("github_bot_email") || "",
    webhook_secret: decryptSecret(dal.getSetting("github_app_webhook_secret")),
  };
}

export function getPublicGitHubAppSettings(request?: Pick<NextRequest, "headers" | "url">): PublicGitHubAppSettings {
  const settings = getGitHubAppSettings();
  const publicServerUrl = settings.public_server_url || (request ? getPublicServerOrigin(request) : "");
  const normalizedServerUrl = publicServerUrl ? normalizeServerUrl(publicServerUrl) : "";
  return {
    public_server_url: settings.public_server_url,
    app_id: settings.app_id,
    private_key_configured: Boolean(settings.private_key),
    callback_suffix: GITHUB_OAUTH_CALLBACK_SUFFIX,
    callback_url: normalizedServerUrl ? `${normalizedServerUrl}${GITHUB_OAUTH_CALLBACK_SUFFIX}` : GITHUB_OAUTH_CALLBACK_SUFFIX,
    client_id: settings.client_id,
    client_secret_configured: Boolean(settings.client_secret),
    app_slug: settings.app_slug,
    install_url: settings.install_url,
    bot_username: settings.bot_username,
    bot_display_name: settings.bot_display_name,
    bot_email: settings.bot_email,
    webhook_secret_configured: Boolean(settings.webhook_secret),
  };
}

export function updateGitHubAppSettings(input: Partial<GitHubAppSettings> & {
  clear_client_secret?: boolean;
  clear_private_key?: boolean;
  clear_webhook_secret?: boolean;
}): void {
  const simpleKeys: Array<[keyof GitHubAppSettings, string]> = [
    ["public_server_url", "public_server_url"],
    ["app_id", "github_app_id"],
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

  if (input.clear_private_key) {
    dal.deleteSetting("github_app_private_key");
    clearGitHubAppInstallationTokenCache();
  } else if (input.private_key !== undefined && input.private_key.trim()) {
    dal.setSetting("github_app_private_key", encryptSecret(input.private_key.trim()));
    clearGitHubAppInstallationTokenCache();
  }

  if (input.clear_webhook_secret) {
    dal.deleteSetting("github_app_webhook_secret");
  } else if (input.webhook_secret !== undefined && input.webhook_secret.trim()) {
    dal.setSetting("github_app_webhook_secret", encryptSecret(input.webhook_secret.trim()));
  }
}

function assertGitHubInstallationConfigured(): GitHubAppSettings {
  const settings = getGitHubAppSettings();
  if (!/^\d+$/.test(settings.app_id.trim())) {
    throw new GitHubAppError("github_app_not_configured", "GitHub App ID is not configured.");
  }
  if (!settings.private_key.trim()) {
    throw new GitHubAppError("github_app_not_configured", "GitHub App private key is not configured.");
  }
  return settings;
}

export async function generateGitHubAppJwt(): Promise<string> {
  const settings = assertGitHubInstallationConfigured();
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey(settings.private_key);
  } catch {
    throw new GitHubAppError("github_app_private_key_invalid", "GitHub App private key is invalid.");
  }

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(settings.app_id.trim())
    .setIssuedAt(now - 60)
    .setExpirationTime(now + APP_JWT_LIFETIME_SECONDS)
    .sign(privateKey);
}

export interface GitHubAppInstallationSummary {
  installation_id: number;
  account_login: string;
  account_type: string | null;
  repository_selection: string | null;
}

export async function listGitHubAppInstallations(): Promise<GitHubAppInstallationSummary[]> {
  const jwt = await generateGitHubAppJwt();
  const installations: GitHubAppInstallationSummary[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`https://api.github.com/app/installations?per_page=100&page=${page}`, {
      headers: githubApiHeaders(jwt),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new GitHubAppError(
        "github_installations_list_failed",
        data.message || `GitHub installation lookup failed (${response.status})`,
        502,
      );
    }

    const pageItems = Array.isArray(data) ? data : [];
    installations.push(...pageItems.map((installation: any) => ({
      installation_id: Number(installation.id),
      account_login: String(installation.account?.login || ""),
      account_type: installation.account?.type ? String(installation.account.type) : null,
      repository_selection: installation.repository_selection ? String(installation.repository_selection) : null,
    })).filter((installation: GitHubAppInstallationSummary) => (
      Number.isInteger(installation.installation_id) && installation.installation_id > 0 && installation.account_login
    )));

    if (pageItems.length < 100) break;
  }

  return installations;
}

export function clearGitHubAppInstallationTokenCache(): void {
  installationTokenCache.clear();
}

export async function getGitHubAppInstallationToken(
  installationId: number,
  repository?: string,
): Promise<{ token: string; expires_at: string }> {
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new GitHubAppError("github_installation_invalid", "GitHub installation ID is invalid.");
  }
  const cacheKey = `${installationId}:${repository || "*"}`;
  const cached = installationTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + REFRESH_SKEW_MS) {
    return { token: cached.token, expires_at: new Date(cached.expiresAt).toISOString() };
  }

  const jwt = await generateGitHubAppJwt();
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { ...githubApiHeaders(jwt), "Content-Type": "application/json" },
    body: repository ? JSON.stringify({ repositories: [repository] }) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.token !== "string" || typeof data.expires_at !== "string") {
    throw new GitHubAppError(
      "github_installation_token_failed",
      data.message || `GitHub installation token request failed (${response.status})`,
      502,
    );
  }

  const expiresAt = Date.parse(data.expires_at);
  if (!Number.isFinite(expiresAt)) {
    throw new GitHubAppError("github_installation_token_invalid", "GitHub returned an invalid installation token expiry.", 502);
  }
  installationTokenCache.set(cacheKey, { token: data.token, expiresAt });
  return { token: data.token, expires_at: data.expires_at };
}

export function getOAuthCallbackUrl(request: Pick<NextRequest, "headers" | "url">): string {
  return `${getPublicServerOrigin(request)}${GITHUB_OAUTH_CALLBACK_SUFFIX}`;
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
