import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { WS_PORT } from "../config";
import { authenticateWsUpgrade, type WsAuthUser } from "./auth";
import { handleConsoleConnection } from "./console-handler";
import { logger } from "../logger";

const log = logger.child({ module: "ws" });

let started = false;
let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;

// Augment WebSocket with auth user data
export interface AuthenticatedWebSocket extends WebSocket {
  user: WsAuthUser;
  isAlive: boolean;
}

/**
 * Start the standalone WebSocket server on WS_PORT.
 * Idempotent — safe to call multiple times.
 */
export function startWsServer(): void {
  if (started) return;
  started = true;

  httpServer = http.createServer((_req, res) => {
    // Health check for the WS server itself
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ws ok");
  });

  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (request, socket, head) => {
    const user = await authenticateWsUpgrade(request);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = url.pathname;

    wss!.handleUpgrade(request, socket, head, (ws) => {
      const authedWs = ws as AuthenticatedWebSocket;
      authedWs.user = user;
      authedWs.isAlive = true;

      // Route based on path
      const consoleMatch = pathname.match(/^\/ws\/console\/(\d+)$/);

      if (consoleMatch) {
        handleConsoleConnection(authedWs, parseInt(consoleMatch[1], 10));
      } else {
        authedWs.close(4000, "Unknown path");
      }
    });
  });

  // Heartbeat — detect stale connections every 30s
  const heartbeatInterval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      const authedWs = ws as AuthenticatedWebSocket;
      if (!authedWs.isAlive) {
        authedWs.terminate();
        return;
      }
      authedWs.isAlive = false;
      authedWs.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  httpServer.listen(WS_PORT, "127.0.0.1", () => {
    log.info({ port: WS_PORT }, "WebSocket server listening");
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log.error({ port: WS_PORT }, "WebSocket port already in use");
    } else {
      log.error({ err }, "WebSocket server error");
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    if (wss) {
      wss.clients.forEach((ws) => ws.close(1001, "Server shutting down"));
      wss.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export function getWss(): WebSocketServer | null {
  return wss;
}
