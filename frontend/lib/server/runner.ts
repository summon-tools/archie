import { execSync, spawn } from "child_process";
import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import { killProcessOnPort } from "./process";
import { ensureArchieDir, resolveLogsDir, resolvePidsDir } from "./app-paths";
import { checkPortSync } from "./platform";
import type { AppManifest } from "./manifest";

// --- Environment Helpers ---

export function buildEnvPrefix(directory: string): string {
  const home = os.homedir();
  const parts: string[] = [
    `export HOME="${home}"`,
  ];

  // --- Node version managers ---
  // nvm
  parts.push(
    `export NVM_DIR="$HOME/.nvm"`,
    `[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`,
  );
  // fnm (if present)
  parts.push(
    `command -v fnm &>/dev/null && eval "$(fnm env)" || true`,
  );

  // --- Ruby version managers (detect which one is installed) ---
  // rbenv
  if (fs.existsSync(path.join(home, ".rbenv"))) {
    parts.push(
      `export PATH="$HOME/.rbenv/bin:$HOME/.rbenv/shims:$PATH"`,
      `eval "$(rbenv init - 2>/dev/null)" || true`,
    );
  }
  // RVM — must source the rvm script, then cd into the directory to trigger
  // RVM's .ruby-version hook (RVM selects the Ruby version on cd, not on source)
  if (fs.existsSync(path.join(home, ".rvm", "scripts", "rvm"))) {
    parts.push(
      `source "$HOME/.rvm/scripts/rvm" 2>/dev/null || true`,
      `cd "${directory}"`,
    );
  }
  // asdf
  if (fs.existsSync(path.join(home, ".asdf"))) {
    parts.push(
      `source "$HOME/.asdf/asdf.sh" 2>/dev/null || true`,
    );
  }

  // --- Python venv (project-scoped) ---
  const venvActivate = path.join(directory, ".venv", "bin", "activate");
  if (fs.existsSync(venvActivate)) {
    parts.push(`source "${venvActivate}"`);
  } else {
    const venvAlt = path.join(directory, "venv", "bin", "activate");
    if (fs.existsSync(venvAlt)) {
      parts.push(`source "${venvAlt}"`);
    }
  }

  return parts.join(" && ");
}

// --- Port Allocation ---

export function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not allocate port")));
      }
    });
    server.on("error", reject);
  });
}

// --- Health Check ---

export async function runHealthCheck(
  port: number,
  healthPath: string = "/",
  timeoutMs: number = 30000
): Promise<{ healthy: boolean; statusCode: number | null; error?: string }> {
  const startTime = Date.now();
  const pollInterval = 2000;
  const requestTimeout = 3000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}${healthPath}`,
          { timeout: requestTimeout },
          (res) => {
            resolve(res.statusCode || 0);
            res.resume();
          }
        );
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
      });
      return { healthy: true, statusCode };
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  // Final check: port bound?
  if (checkPortSync(port)) {
    return { healthy: true, statusCode: null, error: "Port bound but HTTP not responding within timeout" };
  }

  return { healthy: false, statusCode: null, error: `Server did not start within ${timeoutMs}ms` };
}

// checkPort is imported from platform.ts as checkPortSync

// --- Runner Operations ---

export function runInstall(
  directory: string,
  manifest: AppManifest
): { success: boolean; message: string } {
  const envPrefix = buildEnvPrefix(directory);
  const cmd = `${envPrefix} && cd "${directory}" && ${manifest.install.command}`;

  try {
    execSync(cmd, {
      shell: "bash",
      timeout: 120000,
      cwd: directory,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: os.homedir() },
    });
    return { success: true, message: "Dependencies installed" };
  } catch (e: any) {
    const msg = e.stderr?.toString().trim() || e.stdout?.toString().trim() || String(e);
    return { success: false, message: `Install failed: ${msg.slice(0, 500)}` };
  }
}

/**
 * Spawns a single process with the given env setup, writing to its own log and pid file.
 */
function spawnProcess(
  directory: string,
  name: string,
  command: string,
  envPrefix: string,
  envVars: string[],
  envSource: string,
  logDir: string,
  pidDir: string,
  port: number
): { pid: number | null; logFile: string } {
  const logFile = path.join(logDir, `${name}.log`);
  const devCmd = command.replace(/\$PORT/g, String(port));

  // Source .env first, then set explicit vars so PORT/BINDING override .env values
  const fullCmd =
    `${envPrefix} && ` +
    envSource +
    envVars.join(" && ") + " && " +
    `cd "${directory}" && ` +
    `exec ${devCmd}`;

  const logFd = fs.openSync(logFile, "w");
  const child = spawn("bash", ["-c", fullCmd], {
    cwd: directory,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  if (child.pid) {
    fs.writeFileSync(path.join(pidDir, `${name}.pid`), String(child.pid));
  }

  return { pid: child.pid || null, logFile };
}

export function runStart(
  directory: string,
  manifest: AppManifest,
  port: number
): { success: boolean; message: string; pid: number | null; logFile: string } {
  // Kill any leftover process on the port
  killProcessOnPort(port);

  // Ensure directories
  ensureArchieDir(directory);
  const logDir = resolveLogsDir(directory);
  const pidDir = resolvePidsDir(directory);

  // Clean stale PID files
  try {
    for (const f of fs.readdirSync(pidDir).filter((f) => f.endsWith(".pid"))) {
      const pidFile = path.join(pidDir, f);
      try {
        const oldPid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
        try { process.kill(oldPid, 0); process.kill(oldPid, "SIGTERM"); } catch {}
        fs.unlinkSync(pidFile);
      } catch { try { fs.unlinkSync(pidFile); } catch {} }
    }
  } catch {}

  // Clean Rails PID
  const railsPid = path.join(directory, "tmp", "pids", "server.pid");
  if (fs.existsSync(railsPid)) fs.unlinkSync(railsPid);

  // Load .env from directory FIRST so explicit port/host vars below take precedence
  let envSource = "";
  if (fs.existsSync(path.join(directory, ".env"))) {
    envSource = `set -a && source "${directory}/.env" 2>/dev/null && set +a && `;
  }

  // Build env vars — these override anything from .env
  const envVars: string[] = [];
  const portEnv = manifest.dev.port_env || "PORT";
  envVars.push(`export ${portEnv}=${port}`);
  if (manifest.dev.host_env && manifest.dev.host_value) {
    envVars.push(`export ${manifest.dev.host_env}="${manifest.dev.host_value}"`);
  }

  const envPrefix = buildEnvPrefix(directory);

  // --- Multi-process mode ---
  if (manifest.processes && manifest.processes.length > 0) {
    const webProcess = manifest.processes.find((p) => p.web) || manifest.processes[0];
    const supportProcesses = manifest.processes.filter((p) => p !== webProcess);

    try {
      // Start support processes first (asset watchers, workers, etc.)
      for (const proc of supportProcesses) {
        spawnProcess(directory, proc.name, proc.command, envPrefix, envVars, envSource, logDir, pidDir, port);
      }

      // Start the web process last
      const { pid, logFile } = spawnProcess(
        directory, webProcess.name, webProcess.command, envPrefix, envVars, envSource, logDir, pidDir, port
      );

      // Also write app.pid pointing to the web process for backwards compat
      if (pid) {
        fs.writeFileSync(path.join(pidDir, "app.pid"), String(pid));
      }

      const processNames = manifest.processes.map((p) => p.name).join(", ");
      return { success: true, message: `Starting ${processNames} on port ${port}`, pid, logFile };
    } catch (e: any) {
      return { success: false, message: `Failed to start: ${e}`, pid: null, logFile: path.join(logDir, "web.log") };
    }
  }

  // --- Single-process mode (fallback) ---
  const logFile = path.join(logDir, "app.log");

  try {
    const { pid } = spawnProcess(directory, "app", manifest.dev.command, envPrefix, envVars, envSource, logDir, pidDir, port);
    return { success: true, message: `App starting on port ${port}`, pid, logFile };
  } catch (e: any) {
    return { success: false, message: `Failed to start: ${e}`, pid: null, logFile };
  }
}

export function runStop(
  directory: string,
  port?: number
): { success: boolean; message: string } {
  const pidDir = resolvePidsDir(directory);

  // Kill all managed processes from PID files
  try {
    if (fs.existsSync(pidDir)) {
      for (const f of fs.readdirSync(pidDir).filter((f) => f.endsWith(".pid"))) {
        const pidFile = path.join(pidDir, f);
        try {
          const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
          if (!isNaN(pid)) {
            try { process.kill(pid, "SIGTERM"); } catch {}
          }
          fs.unlinkSync(pidFile);
        } catch {
          try { fs.unlinkSync(pidFile); } catch {}
        }
      }
    }
  } catch {}

  // Fallback: kill by port
  if (port && checkPortSync(port)) {
    killProcessOnPort(port);
    // Wait briefly
    const sleep = (ms: number) => { const end = Date.now() + ms; while (Date.now() < end) {} };
    sleep(2000);
    if (checkPortSync(port)) {
      killProcessOnPort(port, true);
      sleep(1000);
    }
    if (checkPortSync(port)) {
      return { success: false, message: `Failed to stop process on port ${port}` };
    }
    return { success: true, message: `Stopped process on port ${port}` };
  }

  return { success: true, message: "App stopped" };
}
