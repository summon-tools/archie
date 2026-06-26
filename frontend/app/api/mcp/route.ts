import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { authenticateMcpBearerToken, McpAuthError, McpForbiddenError } from "@/lib/server/mcp/auth";
import { McpToolError } from "@/lib/server/mcp/errors";
import { callMcpTool } from "@/lib/server/mcp/handlers";
import { getPublicServerOrigin } from "@/lib/server/public-url";
import {
  acceptedResponse,
  isJsonRpcRequest,
  jsonRpcError,
  jsonRpcResponse,
  jsonRpcResult,
  type JsonRpcRequest,
} from "@/lib/server/mcp/protocol";
import { listMcpTools } from "@/lib/server/mcp/registry";

const SERVER_INFO = {
  name: "archie",
  title: "Archie",
  version: "0.1.0",
};

const LOCAL_POSTMAN_ORIGINS = new Set([
  "https://web.postman.co",
]);

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function configuredAllowedOrigins(): Set<string> {
  return new Set((process.env.ARCHIE_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function allowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    if (requestUrl.origin === originUrl.origin) return originUrl.origin;
    if (configuredAllowedOrigins().has(originUrl.origin)) return originUrl.origin;
    if (isLocalHostname(requestUrl.hostname) && LOCAL_POSTMAN_ORIGINS.has(originUrl.origin)) {
      return originUrl.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function appendVary(response: NextResponse, value: string): void {
  const existing = response.headers.get("Vary");
  const parts = new Set((existing ? existing.split(",") : [])
    .map((entry) => entry.trim())
    .filter(Boolean));
  parts.add(value);
  response.headers.set("Vary", Array.from(parts).join(", "));
}

function validateOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (allowedOrigin(request)) return null;
  return responseHeaders(request, NextResponse.json({ detail: "Invalid Origin" }, { status: 403 }));
}

function responseHeaders(request: NextRequest, response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  appendVary(response, "Authorization");
  appendVary(response, "Origin");

  const origin = allowedOrigin(request);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "authorization, content-type, mcp-protocol-version, mcp-session-id");
    response.headers.set("Access-Control-Expose-Headers", "mcp-session-id");
  }

  return response;
}

function sseProbeResponse(request: NextRequest): NextResponse {
  const encoder = new TextEncoder();
  const endpointPath = new URL(request.url).pathname;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpointPath}\n\n`));
      controller.enqueue(encoder.encode(": Archie MCP stream ready\n\n"));
    },
  });
  return responseHeaders(request, new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  }));
}

export async function OPTIONS(request: NextRequest) {
  const originError = validateOrigin(request);
  if (originError) return originError;
  return responseHeaders(request, new NextResponse(null, {
    status: 204,
    headers: { Allow: "GET, POST, OPTIONS" },
  }));
}

function summarizeArgs(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (/token|secret|password|key/i.test(key)) {
      summary[key] = "[redacted]";
    } else if (typeof entry === "string" && entry.length > 500) {
      summary[key] = `${entry.slice(0, 500)}[truncated]`;
    } else {
      summary[key] = entry;
    }
  }
  return JSON.stringify(summary);
}

function summarizeResult(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const structured = record.structuredContent;
  if (structured && typeof structured === "object") {
    try {
      return JSON.stringify(structured).slice(0, 2000);
    } catch {
      return null;
    }
  }
  return null;
}

function appIdFromArgs(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const appId = (value as Record<string, unknown>).app_id;
  return typeof appId === "number" && Number.isInteger(appId) ? appId : null;
}

async function handleRpc(request: NextRequest, rpc: JsonRpcRequest) {
  const principal = authenticateMcpBearerToken(request.headers.get("authorization"));
  const baseUrl = getPublicServerOrigin(request);

  if (rpc.id === undefined && rpc.method.startsWith("notifications/")) {
    return acceptedResponse();
  }

  switch (rpc.method) {
    case "initialize":
      return jsonRpcResponse(jsonRpcResult(rpc.id, {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: SERVER_INFO,
        instructions: "Use Archie tools to inspect apps, ask read-only project questions, start durable tasks, poll task status, and manage app or preview servers when your token allows it.",
      }));

    case "ping":
      return jsonRpcResponse(jsonRpcResult(rpc.id, {}));

    case "tools/list":
      return jsonRpcResponse(jsonRpcResult(rpc.id, { tools: listMcpTools() }));

    case "tools/call": {
      const params = rpc.params && typeof rpc.params === "object" ? rpc.params as Record<string, unknown> : {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments ?? {};
      if (!name) {
        return jsonRpcResponse(jsonRpcError(rpc.id, -32602, "Tool name is required"));
      }

      const startedAt = Date.now();
      try {
        const result = await callMcpTool(name, args, { principal, baseUrl });
        dal.createMcpAuditEvent({
          token_id: principal.tokenId,
          app_id: appIdFromArgs(args),
          tool_name: name,
          input_summary_json: summarizeArgs(args),
          result_summary_json: summarizeResult(result),
          status: "success",
          duration_ms: Date.now() - startedAt,
        });
        return jsonRpcResponse(jsonRpcResult(rpc.id, result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dal.createMcpAuditEvent({
          token_id: principal.tokenId,
          app_id: appIdFromArgs(args),
          tool_name: name,
          input_summary_json: summarizeArgs(args),
          status: "error",
          error_text: message,
          duration_ms: Date.now() - startedAt,
        });
        if (error instanceof McpToolError) {
          return jsonRpcResponse(jsonRpcResult(rpc.id, {
            content: [{ type: "text", text: error.message }],
            isError: true,
          }));
        }
        if (error instanceof McpForbiddenError) {
          return jsonRpcResponse(jsonRpcError(rpc.id, -32003, error.message));
        }
        throw error;
      }
    }

    default:
      return jsonRpcResponse(jsonRpcError(rpc.id, -32601, `Unknown MCP method: ${rpc.method}`));
  }
}

export async function POST(request: NextRequest) {
  const originError = validateOrigin(request);
  if (originError) return originError;

  try {
    const body = await request.json();
    if (!isJsonRpcRequest(body)) {
      return responseHeaders(request, jsonRpcResponse(jsonRpcError(null, -32600, "Invalid JSON-RPC request"), 400));
    }
    return responseHeaders(request, await handleRpc(request, body));
  } catch (error) {
    if (error instanceof McpAuthError) {
      return responseHeaders(request, NextResponse.json({ detail: error.message }, { status: 401 }));
    }
    if (error instanceof McpForbiddenError) {
      return responseHeaders(request, NextResponse.json({ detail: error.message }, { status: 403 }));
    }
    return responseHeaders(request, jsonRpcResponse(
      jsonRpcError(null, -32603, error instanceof Error ? error.message : "Internal MCP error"),
      500,
    ));
  }
}

export async function GET(request: NextRequest) {
  const originError = validateOrigin(request);
  if (originError) return originError;
  try {
    authenticateMcpBearerToken(request.headers.get("authorization"));
  } catch (error) {
    if (error instanceof McpAuthError) {
      return responseHeaders(request, NextResponse.json({ detail: error.message }, { status: 401 }));
    }
    throw error;
  }
  return sseProbeResponse(request);
}
