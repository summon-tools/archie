import fs from "fs";
import type { AuthenticatedWebSocket } from "./server";
import { getDb } from "../db";

interface ManagedProcessRow {
  id: number;
  log_path: string | null;
  pid: number | null;
  status: string;
}

interface ConsoleSubscription {
  watcher: fs.FSWatcher | null;
  clients: Set<AuthenticatedWebSocket>;
  lastPosition: number;
  checkInterval: ReturnType<typeof setInterval> | null;
}

// Track active subscriptions by process ID
const subscriptions = new Map<number, ConsoleSubscription>();

/**
 * Handle an authenticated WebSocket connection for a process console.
 * Routes: /ws/console/:processId
 *
 * Streams the log file for a managed process in real-time using fs.watch.
 */
export function handleConsoleConnection(
  ws: AuthenticatedWebSocket,
  processId: number
): void {
  // Look up the managed process
  const db = getDb();
  const proc = db
    .prepare("SELECT id, log_path, pid, status FROM managed_processes WHERE id = ?")
    .get(processId) as ManagedProcessRow | undefined;

  if (!proc || !proc.log_path) {
    ws.close(4004, "Process not found or no log path");
    return;
  }

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  // Get or create subscription for this process
  let sub = subscriptions.get(processId);
  if (!sub) {
    sub = {
      watcher: null,
      clients: new Set(),
      lastPosition: 0,
      checkInterval: null,
    };
    subscriptions.set(processId, sub);
  }

  sub.clients.add(ws);

  // Send initial history (last 10KB)
  try {
    if (fs.existsSync(proc.log_path)) {
      const stats = fs.statSync(proc.log_path);
      const readFrom = Math.max(0, stats.size - 10240);
      const fd = fs.openSync(proc.log_path, "r");
      const buf = Buffer.alloc(stats.size - readFrom);
      fs.readSync(fd, buf, 0, buf.length, readFrom);
      fs.closeSync(fd);

      ws.send(JSON.stringify({ type: "history", data: buf.toString("utf-8") }));
      sub.lastPosition = Math.max(sub.lastPosition, stats.size);
    }
  } catch {
    // File may not exist yet
  }

  // Send current process status
  ws.send(JSON.stringify({ type: "status", status: proc.status, pid: proc.pid }));

  // Start file watcher if not already running for this process
  if (!sub.watcher && proc.log_path) {
    const logPath = proc.log_path;
    try {
      sub.watcher = fs.watch(logPath, () => {
        readNewBytes(processId, logPath);
      });
    } catch {
      // File may not exist yet — try again on an interval
    }

    // PID liveness check every 5s
    sub.checkInterval = setInterval(() => {
      if (!proc.pid) return;
      try {
        process.kill(proc.pid, 0); // Check if alive
      } catch {
        // Process is dead
        broadcast(processId, { type: "exited" });
        cleanupSubscription(processId);
      }
    }, 5000);
  }

  ws.on("close", () => {
    if (sub) {
      sub.clients.delete(ws);
      if (sub.clients.size === 0) {
        cleanupSubscription(processId);
      }
    }
  });
}

function readNewBytes(processId: number, logPath: string): void {
  const sub = subscriptions.get(processId);
  if (!sub) return;

  try {
    const stats = fs.statSync(logPath);
    if (stats.size <= sub.lastPosition) return;

    const fd = fs.openSync(logPath, "r");
    const buf = Buffer.alloc(stats.size - sub.lastPosition);
    fs.readSync(fd, buf, 0, buf.length, sub.lastPosition);
    fs.closeSync(fd);

    sub.lastPosition = stats.size;
    broadcast(processId, { type: "output", data: buf.toString("utf-8") });
  } catch {
    // File may have been rotated or truncated
  }
}

function broadcast(processId: number, message: object): void {
  const sub = subscriptions.get(processId);
  if (!sub) return;
  const data = JSON.stringify(message);
  for (const client of sub.clients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
}

function cleanupSubscription(processId: number): void {
  const sub = subscriptions.get(processId);
  if (!sub) return;
  if (sub.watcher) {
    sub.watcher.close();
    sub.watcher = null;
  }
  if (sub.checkInterval) {
    clearInterval(sub.checkInterval);
    sub.checkInterval = null;
  }
  if (sub.clients.size === 0) {
    subscriptions.delete(processId);
  }
}
