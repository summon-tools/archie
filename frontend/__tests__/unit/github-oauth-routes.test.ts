import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("GitHub OAuth routes", () => {
  it("redirects back to the configured public origin after callback completion", async () => {
    const completeOAuthConnection = vi.fn(async () => ({}));
    class GitHubAppError extends Error {
      constructor(public readonly code: string, message: string, public readonly status = 400) {
        super(message);
      }
    }

    vi.doMock("@/lib/server/auth", () => ({
      AuthError: class AuthError extends Error {},
      getAuthUser: vi.fn(async () => ({
        id: 1,
        name: "Test User",
        email: "test@example.com",
        role: "member",
        color: null,
      })),
      isSecureRequest: vi.fn(() => true),
    }));
    vi.doMock("@/lib/server/github-app", () => ({
      completeOAuthConnection,
      getPublicServerOrigin: vi.fn(() => "https://i-futur.com"),
      GitHubAppError,
    }));

    const { GET } = await import("@/app/api/github/oauth/callback/route");
    const request = new NextRequest(
      "http://localhost:8080/api/github/oauth/callback?code=abc123&state=state123",
      {
        headers: {
          cookie: "github_oauth_state=state123; github_oauth_verifier=verifier123; github_oauth_user=1",
        },
      },
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("https://i-futur.com/profile?github=connected");
    expect(completeOAuthConnection).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      code: "abc123",
      codeVerifier: "verifier123",
    }));
  });

  it("redirects start errors back to the configured public origin", async () => {
    class GitHubAppError extends Error {
      constructor(public readonly code: string, message: string, public readonly status = 400) {
        super(message);
      }
    }

    vi.doMock("@/lib/server/auth", () => ({
      AuthError: class AuthError extends Error {},
      buildCookieOptions: vi.fn(() => ({ sameSite: "lax", secure: true })),
      getAuthUser: vi.fn(async () => ({
        id: 1,
        name: "Test User",
        email: "test@example.com",
        role: "member",
        color: null,
      })),
      isSecureRequest: vi.fn(() => true),
    }));
    vi.doMock("@/lib/server/github-app", () => ({
      buildOAuthAuthorizeUrl: vi.fn(() => {
        throw new GitHubAppError("github_app_not_configured", "GitHub App client ID is not configured.");
      }),
      generateOAuthVerifier: vi.fn(() => ({ verifier: "verifier123", challenge: "challenge123" })),
      getPublicServerOrigin: vi.fn(() => "https://i-futur.com"),
      GitHubAppError,
    }));

    const { GET } = await import("@/app/api/github/oauth/start/route");
    const request = new NextRequest("http://localhost:8080/api/github/oauth/start");

    const response = await GET(request);

    const redirect = new URL(response.headers.get("location") ?? "");
    expect(`${redirect.origin}${redirect.pathname}`).toBe("https://i-futur.com/profile");
    expect(redirect.searchParams.get("github")).toBe("error");
    expect(redirect.searchParams.get("message")).toBe("GitHub App client ID is not configured.");
  });
});
