/**
 * Client-side WebSocket URL builder for terminal/console connections.
 *
 * The session cookie is httpOnly, so JavaScript cannot read it directly.
 * Instead, we fetch a WS ticket from /api/ws-ticket (authenticated via the
 * httpOnly cookie) and pass it as a query parameter to the WS server.
 */

const DEFAULT_WS_PORT = 8081;

// Cache the token so we don't fetch a new one for every connection
let cachedToken: string | null = null;
let tokenFetchPromise: Promise<string | null> | null = null;

async function fetchWsToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/ws-ticket");
    if (!res.ok) return null;
    const data = await res.json();
    return data.token || null;
  } catch {
    return null;
  }
}

/**
 * Get a valid WS token. Caches the result and deduplicates concurrent calls.
 */
export async function getWsToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;

  if (!tokenFetchPromise) {
    tokenFetchPromise = fetchWsToken().then((token) => {
      cachedToken = token;
      tokenFetchPromise = null;
      // Expire the cache after 1 hour (token itself lasts 72h, but refresh periodically)
      if (token) {
        setTimeout(() => { cachedToken = null; }, 3600_000);
      }
      return token;
    });
  }

  return tokenFetchPromise;
}

/**
 * Build a full WebSocket URL for the given path.
 * Must be called with await since token fetch is async.
 * @param path - e.g., "/ws/terminal/abc123" or "/ws/console/42"
 */
export async function getWsUrl(path: string): Promise<string> {
  const token = await getWsToken();
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";

  const wsPort =
    typeof process !== "undefined" && process.env?.NEXT_PUBLIC_WS_PORT
      ? parseInt(process.env.NEXT_PUBLIC_WS_PORT, 10)
      : DEFAULT_WS_PORT;

  const url = new URL(`${protocol}://${host}:${wsPort}${path}`);
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}
