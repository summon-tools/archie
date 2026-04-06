import { NextResponse } from "next/server";
import { AuthError, ForbiddenError } from "./auth";
import type { ZodError } from "zod";

/**
 * Standardized API response helpers.
 * Use these in API routes for consistent response shapes.
 */

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function apiError(detail: string, status = 400) {
  return NextResponse.json({ detail }, { status });
}

export function apiZodError(error: ZodError) {
  const detail = error.issues.map((e) => e.message).join("; ");
  return NextResponse.json({ detail }, { status: 400 });
}

/**
 * Handles AuthError (401) and ForbiddenError (403).
 * Re-throws anything else.
 */
export function handleAuthError(e: unknown): NextResponse {
  if (e instanceof AuthError) {
    return apiError(e.message, 401);
  }
  if (e instanceof ForbiddenError) {
    return apiError(e.message, 403);
  }
  throw e;
}
