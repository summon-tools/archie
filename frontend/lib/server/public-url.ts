import { NextRequest } from "next/server";
import * as dal from "@/lib/server/dal";

type RequestLike = Pick<NextRequest, "headers" | "url">;

export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

export function getPublicServerOrigin(request: RequestLike): string {
  const configured = dal.getSetting("public_server_url");
  if (configured) return normalizeServerUrl(configured);

  const requestUrl = new URL(request.url);
  const proto = firstHeaderValue(request.headers.get("x-forwarded-proto")) || requestUrl.protocol.replace(":", "");
  const host = firstHeaderValue(request.headers.get("x-forwarded-host")) || request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return requestUrl.origin;
}
