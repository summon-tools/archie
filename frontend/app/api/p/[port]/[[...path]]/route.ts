import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";

/**
 * Reverse proxy for preview iframes.
 * Routes /api/p/PORT/any/path → http://127.0.0.1:PORT/any/path
 * Strips X-Frame-Options and CSP headers.
 * Rewrites absolute URLs in HTML so subresources also flow through the proxy.
 */

const STRIP_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
]);

function rewriteUrls(text: string, proxyBase: string): string {
  // Rewrite url() references: url(/path), url('/path'), url("/path")
  let result = text.replace(
    /url\(\s*(['"]?)\/(?!\/|api\/p\/|data:)/gi,
    `url($1${proxyBase}/`
  );

  // Rewrite absolute http://127.0.0.1:PORT URLs in url()
  result = result.replace(
    /url\(\s*(['"]?)http:\/\/127\.0\.0\.1:\d+\//gi,
    `url($1${proxyBase}/`
  );

  // Rewrite @import with bare strings: @import "/path" or @import '/path'
  result = result.replace(
    /(@import\s+['"])\/(?!\/|api\/p\/)/gi,
    `$1${proxyBase}/`
  );

  return result;
}

function rewriteJs(js: string, proxyBase: string): string {
  // Rewrite webpack/webpacker public path assignments:
  // __webpack_public_path__ = "/packs/"  →  __webpack_public_path__ = "/api/p/PORT/packs/"
  let result = js.replace(
    /(__webpack_public_path__\s*=\s*['"])\/(?!\/|api\/p\/)/g,
    `$1${proxyBase}/`
  );
  // Minified webpack runtime: e.g. r.p="/packs/", n.p="/assets/"
  // Only match single-char identifiers to avoid false positives on arbitrary `.prop = "/..."`
  result = result.replace(
    /([a-zA-Z]\.p\s*=\s*['"])\/(?!\/|api\/p\/)/g,
    `$1${proxyBase}/`
  );

  return result;
}

function rewriteHtml(html: string, proxyBase: string): string {
  // Rewrite absolute paths in src, href, action attributes
  // Match: attr="/path" but not attr="//..." or attr="http..." or already proxied
  let result = html.replace(
    /((?:src|href|action|poster|data)\s*=\s*["'])\/(?!\/|api\/p\/)/gi,
    `$1${proxyBase}/`
  );

  // Rewrite absolute http://127.0.0.1:PORT URLs in attributes
  // (e.g. Rails Active Storage generates absolute URLs based on the request host)
  result = result.replace(
    /((?:src|href|action|poster|data)\s*=\s*["'])http:\/\/127\.0\.0\.1:\d+\//gi,
    `$1${proxyBase}/`
  );

  // Rewrite srcset absolute paths
  result = result.replace(
    /(srcset\s*=\s*["'][^"']*)\/(?!\/|api\/p\/)/gi,
    (match) => {
      // srcset can have multiple URLs, rewrite each absolute path
      return match.replace(/(?<=[\s,"])\/(?!\/|api\/p\/)/g, `${proxyBase}/`);
    }
  );

  // Rewrite url() and @import in inline styles and <style> blocks
  result = rewriteUrls(result, proxyBase);

  return result;
}

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ port: string; path?: string[] }> }
) {
  // Auth check — iframe requests carry same-origin cookies
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }
  }

  const { port: portStr, path: pathSegments } = await params;
  const port = Number(portStr);

  if (isNaN(port) || port < 1 || port > 65535) {
    return NextResponse.json({ detail: "Invalid port" }, { status: 400 });
  }

  const targetPath = pathSegments ? `/${pathSegments.join("/")}` : "/";
  // Preserve query string
  const search = request.nextUrl.search || "";
  const targetUrl = `http://127.0.0.1:${port}${targetPath}${search}`;
  const proxyBase = `/api/p/${port}`;

  try {
    // Forward headers, excluding host
    const forwardHeaders = new Headers();
    const targetOrigin = `http://127.0.0.1:${port}`;
    request.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "host" || lower === "connection") return;
      // Strip X-Forwarded-* headers — they refer to the Archie frontend,
      // not the preview server, and cause frameworks like Rails to compute
      // a mismatched request.base_url (breaking CSRF checks).
      if (lower.startsWith("x-forwarded-")) return;
      forwardHeaders.set(key, value);
    });
    forwardHeaders.set("host", `127.0.0.1:${port}`);
    // Rewrite Origin and Referer so CSRF checks (Rails, Django, etc.) pass.
    // The browser sends these as the Archie origin, but the target server
    // expects them to match its own host.
    if (forwardHeaders.has("origin")) {
      forwardHeaders.set("origin", targetOrigin);
    }
    const referer = forwardHeaders.get("referer");
    if (referer) {
      try {
        const refUrl = new URL(referer);
        refUrl.host = `127.0.0.1:${port}`;
        refUrl.protocol = "http:";
        // Strip the /api/p/PORT prefix from the referer path
        refUrl.pathname = refUrl.pathname.replace(`/api/p/${port}`, "") || "/";
        forwardHeaders.set("referer", refUrl.toString());
      } catch {}
    }

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const resp = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      // Node.js requires duplex: "half" when sending a ReadableStream body
      ...(hasBody ? { duplex: "half" as const } : {}),
    } as RequestInit);

    // Handle redirects — rewrite Location header to go through proxy
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (location) {
        let newLocation = location;
        // Absolute path redirect
        if (location.startsWith("/")) {
          newLocation = `${proxyBase}${location}`;
        }
        // Same-origin redirect
        else if (location.startsWith(`http://127.0.0.1:${port}`)) {
          newLocation = `${proxyBase}${location.substring(`http://127.0.0.1:${port}`.length)}`;
        }
        const headers = new Headers();
        headers.set("location", newLocation);
        // Preserve Set-Cookie headers on redirects (critical for session cookies)
        for (const cookie of resp.headers.getSetCookie()) {
          headers.append("set-cookie", cookie);
        }
        return new NextResponse(null, { status: resp.status, headers });
      }
    }

    // Build response headers — use append() for Set-Cookie to preserve
    // multiple cookies (set() overwrites, losing all but the last one)
    const responseHeaders = new Headers();
    resp.headers.forEach((value, key) => {
      if (!STRIP_HEADERS.has(key.toLowerCase())) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    });

    // Node.js fetch auto-decompresses gzip/brotli but keeps the original
    // Content-Encoding header. Strip it so browsers don't try to decompress
    // an already-decompressed body (ERR_CONTENT_DECODING_FAILED).
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    const contentType = resp.headers.get("content-type") || "";
    const isHtml = contentType.includes("text/html");
    const isCss = contentType.includes("text/css");
    const isJs = contentType.includes("javascript");

    if (isHtml) {
      const html = await resp.text();
      const rewritten = rewriteHtml(html, proxyBase);
      return new NextResponse(rewritten, {
        status: resp.status,
        headers: responseHeaders,
      });
    }

    if (isCss) {
      const css = await resp.text();
      const rewritten = rewriteUrls(css, proxyBase);
      return new NextResponse(rewritten, {
        status: resp.status,
        headers: responseHeaders,
      });
    }

    if (isJs) {
      // Rewrite webpack public path so dynamically loaded chunks
      // (e.g. Rails Webpacker /packs/...) route through the proxy
      const js = await resp.text();
      const rewritten = rewriteJs(js, proxyBase);
      return new NextResponse(rewritten, {
        status: resp.status,
        headers: responseHeaders,
      });
    }

    // For other content types, stream the response directly
    return new NextResponse(resp.body, {
      status: resp.status,
      headers: responseHeaders,
    });
  } catch {
    return new NextResponse(
      `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#888;background:#1a1a1a">
        <div style="text-align:center">
          <p style="font-size:14px">Cannot connect to preview on port ${port}</p>
          <p style="font-size:12px;opacity:0.6;margin-top:8px">The preview server may not be running</p>
        </div>
      </body></html>`,
      {
        status: 502,
        headers: { "content-type": "text/html; charset=utf-8" },
      }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
export const HEAD = proxyRequest;
export const OPTIONS = proxyRequest;
