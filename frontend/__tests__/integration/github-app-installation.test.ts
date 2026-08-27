import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { decodeJwt } from "jose";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("github-app-installation-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
  vi.restoreAllMocks();
});

describe("GitHub App installation authentication", () => {
  it("generates an App JWT and exchanges it for a scoped installation token", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    db.prepare("INSERT INTO system_settings (key, value_json) VALUES (?, ?), (?, ?)").run(
      "github_app_id", JSON.stringify("12345"),
      "github_app_private_key", JSON.stringify(privateKeyPem),
    );

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: "ghs_test_token", expires_at: expiresAt }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const githubApp = await import("@/lib/server/github-app");
    const jwt = await githubApp.generateGitHubAppJwt();
    const claims = decodeJwt(jwt);
    expect(claims.iss).toBe("12345");
    expect(Number(claims.exp) - Number(claims.iat)).toBe(9 * 60 + 60);

    const first = await githubApp.getGitHubAppInstallationToken(9876, "web");
    const second = await githubApp.getGitHubAppInstallationToken(9876, "web");
    expect(first).toEqual({ token: "ghs_test_token", expires_at: expiresAt });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/app/installations/9876/access_tokens");
    expect(options.method).toBe("POST");
    expect(new Headers(options.headers).get("authorization")).toMatch(/^Bearer ey/);
    expect(JSON.parse(String(options.body))).toEqual({ repositories: ["web"] });
  });

  it("does not expose the private key in public settings", async () => {
    db.prepare("INSERT INTO system_settings (key, value_json) VALUES (?, ?), (?, ?)").run(
      "github_app_id", JSON.stringify("12345"),
      "github_app_private_key", JSON.stringify("private-key"),
    );

    const { getPublicGitHubAppSettings } = await import("@/lib/server/github-app");
    const settings = getPublicGitHubAppSettings();
    expect(settings.app_id).toBe("12345");
    expect(settings.private_key_configured).toBe(true);
    expect("private_key" in settings).toBe(false);
  });

  it("lists the GitHub App installations without exposing credentials", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    db.prepare("INSERT INTO system_settings (key, value_json) VALUES (?, ?), (?, ?)").run(
      "github_app_id", JSON.stringify("12345"),
      "github_app_private_key", JSON.stringify(privateKeyPem),
    );

    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{
      id: 9876,
      account: { login: "ericdegboe", type: "User" },
      repository_selection: "selected",
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const githubApp = await import("@/lib/server/github-app");
    await expect(githubApp.listGitHubAppInstallations()).resolves.toEqual([{
      installation_id: 9876,
      account_login: "ericdegboe",
      account_type: "User",
      repository_selection: "selected",
    }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/app/installations?per_page=100&page=1",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });
});
