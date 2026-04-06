import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock config before importing auth
vi.mock("@/lib/server/config", () => ({
  AUTH_SECRET_KEY: "test-secret-key-for-vitest-32chars!!",
  MODE: "development",
  FORCE_SECURE_COOKIES: false,
}));

import {
  verifyPassword,
  hashPassword,
  createToken,
  decodeToken,
  AuthError,
  ForbiddenError,
  COOKIE_NAME,
  buildCookieOptions,
  isSecureRequest,
} from "@/lib/server/auth";

describe("Password hashing", () => {
  it("hashes a password and verifies it", () => {
    const password = "my-secret-password";
    const hash = hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix
    expect(verifyPassword(password, hash)).toBe(true);
  });

  it("rejects wrong password", () => {
    const hash = hashPassword("correct-password");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces different hashes for the same password (salted)", () => {
    const hash1 = hashPassword("password");
    const hash2 = hashPassword("password");
    expect(hash1).not.toBe(hash2);
    // But both should verify
    expect(verifyPassword("password", hash1)).toBe(true);
    expect(verifyPassword("password", hash2)).toBe(true);
  });
});

describe("JWT tokens", () => {
  it("creates and decodes a token", async () => {
    const token = await createToken(42, "Alice", "admin");
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // JWT format

    const payload = await decodeToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("42");
    expect(payload!.name).toBe("Alice");
    expect(payload!.role).toBe("admin");
  });

  it("decodes token with member role", async () => {
    const token = await createToken(7, "Bob", "member");
    const payload = await decodeToken(token);
    expect(payload!.role).toBe("member");
    expect(payload!.name).toBe("Bob");
  });

  it("defaults to member role", async () => {
    const token = await createToken(1, "Charlie");
    const payload = await decodeToken(token);
    expect(payload!.role).toBe("member");
  });

  it("returns null for invalid token", async () => {
    const payload = await decodeToken("invalid.token.here");
    expect(payload).toBeNull();
  });

  it("returns null for empty string", async () => {
    const payload = await decodeToken("");
    expect(payload).toBeNull();
  });

  it("returns null for tampered token", async () => {
    const token = await createToken(1, "Test");
    // Corrupt the signature by replacing several characters
    const parts = token.split(".");
    const sig = parts[2];
    parts[2] = sig.slice(0, -4) + "XXXX";
    const tampered = parts.join(".");
    const payload = await decodeToken(tampered);
    expect(payload).toBeNull();
  });
});

describe("AuthError and ForbiddenError", () => {
  it("AuthError is an instance of Error", () => {
    const err = new AuthError("not logged in");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.message).toBe("not logged in");
    expect(err.name).toBe("AuthError");
  });

  it("ForbiddenError is an instance of Error", () => {
    const err = new ForbiddenError("no access");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("no access");
    expect(err.name).toBe("ForbiddenError");
  });
});

describe("Cookie helpers", () => {
  it("COOKIE_NAME is session_token", () => {
    expect(COOKIE_NAME).toBe("session_token");
  });

  it("buildCookieOptions returns correct shape for secure", () => {
    const opts = buildCookieOptions(true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(72 * 3600);
  });

  it("buildCookieOptions returns secure=false for non-secure", () => {
    const opts = buildCookieOptions(false);
    expect(opts.secure).toBe(false);
  });

  it("isSecureRequest detects x-forwarded-proto", () => {
    const request = {
      headers: {
        get: (name: string) =>
          name === "x-forwarded-proto" ? "https" : null,
      },
    } as any;
    expect(isSecureRequest(request)).toBe(true);
  });

  it("isSecureRequest returns false for http", () => {
    const request = {
      headers: {
        get: (name: string) =>
          name === "x-forwarded-proto" ? "http" : null,
      },
    } as any;
    expect(isSecureRequest(request)).toBe(false);
  });
});
