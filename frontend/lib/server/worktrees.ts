import { execFileSync, execSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { killProcessOnPort } from "./process";
import { checkPortSync } from "./platform";
import {
  type TechStack,
  detectTechStack,
  getWorktreeDatabaseName,
} from "./techstack";
import {
  resolveLogsDir,
  resolvePidsDir,
  ensureArchieDir,
} from "./app-paths";
import { readManifest, generateManifest } from "./manifest";
import type { AppManifest } from "./manifest";
import { runInstall, runStart, runStop as runnerStop, runHealthCheck, buildEnvPrefix, allocateFreePort } from "./runner";

/**
 * Remove a specific variable from a .env file in the given directory.
 * The runner sets PORT dynamically, so a hardcoded PORT from the main app
 * would conflict with the preview port.
 */
function stripEnvVar(directory: string, varName: string): void {
  const envPath = path.join(directory, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    const filtered = content
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        // Remove lines like PORT=1234 or export PORT=1234
        return !trimmed.startsWith(`${varName}=`) && !trimmed.startsWith(`export ${varName}=`);
      })
      .join("\n");
    fs.writeFileSync(envPath, filtered, "utf-8");
  } catch {
    // Non-fatal
  }
}

function runGitSafe(directory: string, args: string[], timeout = 30000): { stdout: string; returncode: number } {
  const env = { ...process.env, HOME: os.homedir(), GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes" };
  try {
    const stdout = execFileSync("git", args, {
      cwd: directory,
      timeout,
      env,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, returncode: 0 };
  } catch (e: any) {
    return { stdout: (e.stdout?.toString() || "") + (e.stderr?.toString() || ""), returncode: e.status ?? 1 };
  }
}

function slugify(text: string, maxLen = 40): string {
  let slug = text.toLowerCase().trim();
  slug = slug.replace(/[^a-z0-9\s-]/g, "");
  slug = slug.replace(/[\s]+/g, "-");
  slug = slug.replace(/-+/g, "-");
  slug = slug.replace(/^-|-$/g, "");
  return slug.slice(0, maxLen);
}

// checkPort is imported from platform.ts as checkPortSync

export { allocateFreePort } from "./runner";

/** @deprecated Use allocateFreePort() instead */
export function allocatePort(usedPorts: number[]): number | null {
  // Kept temporarily for any call-sites; prefer allocateFreePort()
  const usedSet = new Set(usedPorts);
  for (let port = 9001; port <= 9050; port++) {
    if (!usedSet.has(port) && !checkPortSync(port)) {
      return port;
    }
  }
  return null;
}

function copyDatabases(sourceDir: string, destDir: string): void {
  const patterns = ["**/*.db", "**/*.db-journal", "**/*.db-wal", "**/*.db-shm"];
  // Simple recursive scan for .db files
  function walk(dir: string, rel: string) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const full = path.join(dir, entry.name);
        const relPath = path.join(rel, entry.name);
        if (entry.isDirectory()) {
          walk(full, relPath);
        } else if (
          entry.name.endsWith(".db") ||
          entry.name.endsWith(".db-journal") ||
          entry.name.endsWith(".db-wal") ||
          entry.name.endsWith(".db-shm")
        ) {
          const dest = path.join(destDir, relPath);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(full, dest);
        }
      }
    } catch {
      // ignore
    }
  }
  walk(sourceDir, "");
}

// --- PostgreSQL Helpers ---

function setupPostgresDatabase(
  originalDbName: string,
  worktreeDbName: string
): { success: boolean; message: string } {
  try {
    // Check if database already exists
    const check = execSync(
      `psql -lqt 2>/dev/null | cut -d '|' -f 1 | grep -qw "${worktreeDbName}"`,
      { shell: "bash", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
    );
    // If we get here without error, DB exists
    return { success: true, message: `Database ${worktreeDbName} already exists` };
  } catch {
    // DB doesn't exist, create it
  }

  try {
    execSync(`createdb "${worktreeDbName}"`, {
      shell: "bash",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e: any) {
    return { success: false, message: `Failed to create database: ${e.stderr?.toString().slice(0, 300)}` };
  }

  // Copy data from original database
  try {
    execSync(`pg_dump "${originalDbName}" | psql "${worktreeDbName}"`, {
      shell: "bash",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, message: `Database ${worktreeDbName} created and populated from ${originalDbName}` };
  } catch (e: any) {
    // DB was created but dump/restore failed — still usable
    return { success: true, message: `Database ${worktreeDbName} created but data copy had warnings` };
  }
}

function teardownPostgresDatabase(worktreeDbName: string): { success: boolean; message: string } {
  try {
    execSync(`dropdb --if-exists "${worktreeDbName}"`, {
      shell: "bash",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, message: `Database ${worktreeDbName} dropped` };
  } catch (e: any) {
    return { success: false, message: `Failed to drop database: ${e.stderr?.toString().slice(0, 300)}` };
  }
}

function patchDatabaseYml(worktreeDir: string, newDbName: string): void {
  const dbYmlPath = path.join(worktreeDir, "config", "database.yml");
  if (!fs.existsSync(dbYmlPath)) return;

  let content = fs.readFileSync(dbYmlPath, "utf-8");
  const lines = content.split("\n");
  const result: string[] = [];

  let inDevelopment = false;
  let replaced = false;

  for (const line of lines) {
    // Detect top-level section headers
    if (/^\S/.test(line) && line.trim().endsWith(":")) {
      inDevelopment = line.trim() === "development:";
    }

    if (inDevelopment && !replaced && /^\s+database:/.test(line)) {
      const indent = line.match(/^(\s+)/)?.[1] || "  ";
      result.push(`${indent}database: ${newDbName}`);
      replaced = true;
    } else {
      result.push(line);
    }
  }

  fs.writeFileSync(dbYmlPath, result.join("\n"));
}

// --- Dependency Installation ---

function buildInstallCommand(pm: "yarn" | "npm" | "pnpm" | "bun", dir: string): string {
  const nvmSource =
    `export NVM_DIR="$HOME/.nvm" && ` +
    `[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && `;
  const cdDir = `cd "${dir}" && `;

  switch (pm) {
    case "yarn":
      return nvmSource + cdDir + "yarn install --ignore-engines";
    case "pnpm":
      return nvmSource + cdDir + "pnpm install";
    case "bun":
      return nvmSource + cdDir + "bun install";
    default:
      return nvmSource + cdDir + "npm install";
  }
}

function detectDevCommand(worktreeDir: string): {
  portFlag: string;
  hostFlag: string;
} {
  const hasNext =
    fs.existsSync(path.join(worktreeDir, "next.config.js")) ||
    fs.existsSync(path.join(worktreeDir, "next.config.mjs")) ||
    fs.existsSync(path.join(worktreeDir, "next.config.ts"));

  if (hasNext) {
    return { portFlag: "-p", hostFlag: "-H" };
  }
  return { portFlag: "--port", hostFlag: "--host" };
}

function ensureDependencies(worktreeDir: string, stack?: TechStack): { ok: boolean; message: string } {
  const envPrefix = buildEnvPrefix(worktreeDir);
  const messages: string[] = [];

  // Bundle manager (Ruby/Python)
  if (stack?.bundleManager === "bundle") {
    try {
      const bundleCmd =
        `${envPrefix} && ` +
        `cd "${worktreeDir}" && bundle check > /dev/null 2>&1 || bundle install`;
      execSync(bundleCmd, {
        shell: "bash",
        timeout: 120000,
        cwd: worktreeDir,
        stdio: ["pipe", "pipe", "pipe"],
      });
      messages.push("Ruby dependencies OK");
    } catch (e: any) {
      return { ok: false, message: `bundle install failed: ${e.stderr?.toString().slice(0, 300)}` };
    }
  }

  // Package manager (JS)
  const pm = stack?.packageManager;
  const pkgJson = path.join(worktreeDir, "package.json");
  if (fs.existsSync(pkgJson)) {
    const binDir = path.join(worktreeDir, "node_modules", ".bin");
    if (!fs.existsSync(binDir)) {
      const installCmd = pm
        ? `${envPrefix} && cd "${worktreeDir}" && ${buildInstallCommand(pm, worktreeDir)}`
        : `${envPrefix} && cd "${worktreeDir}" && npm install`;
      try {
        execSync(installCmd, {
          shell: "bash",
          timeout: 120000,
          cwd: worktreeDir,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e: any) {
        return { ok: false, message: `${pm || "npm"} install failed: ${e.stderr?.toString().slice(0, 300)}` };
      }
      if (!fs.existsSync(binDir)) {
        return { ok: false, message: `${pm || "npm"} install completed but node_modules/.bin still missing` };
      }
      messages.push("JS dependencies reinstalled");
    } else {
      messages.push("JS dependencies OK");
    }
  }

  return { ok: true, message: messages.join("; ") || "Dependencies OK" };
}

// --- Worktree Lifecycle ---

/** Creates a worktree. Accepts workItemId (or legacy taskId) + title. */
export function createWorktree(
  appDir: string,
  taskId: number, // workItemId (parameter kept as taskId for directory naming compat)
  taskTitle: string
): { success: boolean; message: string; branch_name: string; worktree_dir: string; techStack?: TechStack } {
  if (!fs.existsSync(path.join(appDir, ".git"))) {
    return { success: false, message: "App directory is not a git repository. Initialize git first.", branch_name: "", worktree_dir: "" };
  }

  const slug = slugify(taskTitle);
  const branchName = `task/${taskId}-${slug}`;
  const appBasename = path.basename(appDir.replace(/\/+$/, ""));
  const worktreeDir = path.join(path.dirname(appDir), `${appBasename}-task-${taskId}`);

  // A previous task may have removed its directory without removing Git's
  // worktree metadata. Prune first so a stale record cannot block this task ID.
  runGitSafe(appDir, ["worktree", "prune"], 15000);

  if (fs.existsSync(worktreeDir)) {
    return { success: false, message: `Worktree directory already exists: ${worktreeDir}`, branch_name: branchName, worktree_dir: worktreeDir };
  }

  try {
    // Fetch latest from remote (if available) so the worktree branches
    // from the newest commit — but never touch the main working tree.
    const remote = runGitSafe(appDir, ["remote", "get-url", "origin"]);
    let startPoint: string | null = null;
    if (remote.returncode === 0) {
      const br = runGitSafe(appDir, ["branch", "--show-current"]);
      const branch = br.stdout.trim() || "main";
      const fetchResult = runGitSafe(appDir, ["fetch", "origin", branch], 15000);
      if (fetchResult.returncode === 0) {
        startPoint = `origin/${branch}`;
      }
    }

    // Create worktree with new branch, from the remote tip if available
    const worktreeArgs = startPoint
      ? ["worktree", "add", "-b", branchName, worktreeDir, startPoint]
      : ["worktree", "add", "-b", branchName, worktreeDir];
    let result = runGitSafe(appDir, worktreeArgs);
    if (result.returncode !== 0) {
      if (result.stdout.includes("already exists")) {
        result = runGitSafe(appDir, ["worktree", "add", worktreeDir, branchName]);
        if (result.returncode !== 0) {
          return { success: false, message: `Failed to create worktree: ${result.stdout}`, branch_name: branchName, worktree_dir: "" };
        }
      } else {
        return { success: false, message: `Failed to create worktree: ${result.stdout}`, branch_name: branchName, worktree_dir: "" };
      }
    }

    // Detect tech stack
    const stack = detectTechStack(worktreeDir);

    // Database setup based on stack
    if (stack.database === "postgresql" && stack.databaseName) {
      const worktreeDbName = getWorktreeDatabaseName(stack.databaseName, taskId);
      setupPostgresDatabase(stack.databaseName, worktreeDbName);
      patchDatabaseYml(worktreeDir, worktreeDbName);
    } else if (stack.database === "sqlite" || stack.database === "none") {
      // SQLite: copy .db files as before
      copyDatabases(appDir, worktreeDir);
    }

    // Strip PORT from worktree .env — the runner sets it dynamically at start
    // time, and a hardcoded PORT from the main app would override the preview port.
    stripEnvVar(worktreeDir, "PORT");

    // Install dependencies using stack-aware function
    const depResult = ensureDependencies(worktreeDir, stack);
    if (!depResult.ok) {
      return {
        success: true,
        message: `Worktree created but dependency install had issues: ${depResult.message}`,
        branch_name: branchName,
        worktree_dir: worktreeDir,
        techStack: stack,
      };
    }

    // Symlink Python venv if it exists
    const venvDir = path.join(appDir, "venv");
    if (fs.existsSync(venvDir) && !fs.existsSync(path.join(worktreeDir, "venv"))) {
      try {
        fs.symlinkSync(venvDir, path.join(worktreeDir, "venv"));
      } catch {
        // ignore
      }
    }

    return {
      success: true,
      message: `Worktree created on branch ${branchName}`,
      branch_name: branchName,
      worktree_dir: worktreeDir,
      techStack: stack,
    };
  } catch (e: any) {
    return { success: false, message: String(e), branch_name: branchName, worktree_dir: "" };
  }
}

export function removeWorktree(
  appDir: string,
  worktreeDir: string,
  branchName: string
): { success: boolean; message: string } {
  // PostgreSQL cleanup: detect stack and drop worktree database
  if (fs.existsSync(worktreeDir)) {
    try {
      const stack = detectTechStack(worktreeDir);
      if (stack.database === "postgresql" && stack.databaseName) {
        // Extract taskId from worktree directory name (pattern: *-task-N)
        const taskIdMatch = worktreeDir.match(/-task-(\d+)\/?$/);
        if (taskIdMatch) {
          const taskId = parseInt(taskIdMatch[1], 10);
          const worktreeDbName = getWorktreeDatabaseName(stack.databaseName, taskId);
          teardownPostgresDatabase(worktreeDbName);
        }
      }
    } catch {
      // Best effort — don't block worktree removal
    }
  }

  try {
    const result = runGitSafe(appDir, ["worktree", "remove", worktreeDir, "--force"]);
    if (result.returncode !== 0) {
      if (fs.existsSync(worktreeDir)) {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      }
      runGitSafe(appDir, ["worktree", "prune"]);
    }

    if (branchName) {
      runGitSafe(appDir, ["branch", "-D", branchName]);
    }

    return { success: true, message: `Worktree and branch ${branchName} removed` };
  } catch (e: any) {
    if (fs.existsSync(worktreeDir)) {
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
    runGitSafe(appDir, ["worktree", "prune"]);
    return { success: true, message: `Worktree cleaned up (with warnings): ${e}` };
  }
}

// --- Preview Server ---

function findMainAppDir(worktreeDir: string): string | null {
  const base = worktreeDir.replace(/\/+$/, "");
  const match = base.match(/^(.*?)-task-\d+$/);
  if (match && fs.existsSync(match[1])) return match[1];
  return null;
}


export async function startPreview(
  worktreeDir: string,
  port: number,
  techStack?: TechStack,
  opts?: { appId?: number; workItemId?: number }
): Promise<{ success: boolean; message: string; pid: number | null; healthy: boolean; statusCode: number | null }> {
  if (!fs.existsSync(worktreeDir)) {
    return { success: false, message: `Worktree directory not found: ${worktreeDir}`, pid: null, healthy: false, statusCode: null };
  }

  if (checkPortSync(port)) {
    return { success: false, message: `Port ${port} is already in use`, pid: null, healthy: false, statusCode: null };
  }

  // Detect stack if not provided
  const stack = techStack || detectTechStack(worktreeDir);

  // Read or generate manifest for the worktree
  let manifest = readManifest(worktreeDir);
  if (!manifest) {
    // Try main app dir
    const mainAppDir = findMainAppDir(worktreeDir);
    if (mainAppDir) {
      manifest = readManifest(mainAppDir);
    }
  }
  if (!manifest) {
    manifest = generateManifest(stack, port, worktreeDir);
  }

  // Ensure dependencies
  const depCheck = ensureDependencies(worktreeDir, stack);
  if (!depCheck.ok) {
    return { success: false, message: depCheck.message, pid: null, healthy: false, statusCode: null };
  }

  // Run worktree prepare command if present
  if (manifest.worktree?.prepare_command) {
    try {
      const envPrefix = buildEnvPrefix(worktreeDir);
      execSync(
        `${envPrefix} && cd "${worktreeDir}" && ${manifest.worktree.prepare_command}`,
        { shell: "bash", timeout: 60000, cwd: worktreeDir, stdio: ["pipe", "pipe", "pipe"] }
      );
    } catch {
      // Non-fatal — log but continue
    }
  }

  try {
    // Use the runner to start
    const startResult = runStart(worktreeDir, manifest, port);
    if (!startResult.success) {
      return { success: false, message: startResult.message, pid: null, healthy: false, statusCode: null };
    }

    // Register as managed process for live console
    if (startResult.pid && opts?.appId) {
      try {
        const { registerProcess } = await import("./dal/processes");
        registerProcess({
          app_id: opts.appId,
          kind: "preview",
          pid: startResult.pid,
          port,
          log_path: startResult.logFile,
          work_item_id: opts.workItemId,
        });
      } catch {
        // Non-critical
      }
    }

    // Wait for server to become healthy
    const healthPath = manifest.dev.health_path || "/";
    const health = await runHealthCheck(port, healthPath);

    return {
      success: true,
      message: health.healthy
        ? `Preview server running on port ${port}`
        : `Preview server started on port ${port} (health check: ${health.error || "pending"})`,
      pid: startResult.pid,
      healthy: health.healthy,
      statusCode: health.statusCode,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to start preview: ${e}`, pid: null, healthy: false, statusCode: null };
  }
}

export function stopPreview(
  pid: number | null,
  worktreeDir?: string | null,
  port?: number | null,
  opts?: { appId?: number; workItemId?: number }
): { success: boolean; message: string } {
  if (!pid && !port) {
    return { success: false, message: "No PID or port provided" };
  }

  // Use runner to stop via PID files + port
  if (worktreeDir) {
    const result = runnerStop(worktreeDir, port || undefined);
    // Also kill wrapper process group
    if (pid) {
      try { process.kill(-pid, "SIGTERM"); } catch {}
    }
    if (result.success) {
      markPreviewProcessStopped(opts?.appId, opts?.workItemId);
      return { success: true, message: "Preview server stopped" };
    }
  }

  // Fallback: kill by process group
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
      if (!port || !checkPortSync(port)) {
        markPreviewProcessStopped(opts?.appId, opts?.workItemId);
        return { success: true, message: "Preview server stopped" };
      }
    } catch {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }

  // Final fallback: kill by port
  if (port && checkPortSync(port)) {
    killProcessOnPort(port);
    markPreviewProcessStopped(opts?.appId, opts?.workItemId);
    return { success: true, message: "Preview server stopped (killed by port)" };
  }

  markPreviewProcessStopped(opts?.appId, opts?.workItemId);
  return { success: true, message: "Preview server stopped" };
}

/** Mark the active preview managed process as stopped (best effort). */
function markPreviewProcessStopped(appId?: number, workItemId?: number) {
  if (!appId) return;
  try {
    const { getActiveProcess, updateProcessStatus } = require("./dal/processes");
    const proc = getActiveProcess(appId, "preview", workItemId);
    if (proc) {
      updateProcessStatus(proc.id, "stopped");
    }
  } catch { /* Non-critical */ }
}

export function getPreviewStatus(port: number | null): { running: boolean; port: number | null; url: string | null } {
  const running = port ? checkPortSync(port) : false;
  return {
    running,
    port,
    url: running ? `http://0.0.0.0:${port}` : null,
  };
}

// --- Merge ---

export function mergeToMain(appDir: string, branchName: string): { success: boolean; message: string } {
  try {
    const current = runGitSafe(appDir, ["branch", "--show-current"]);
    if (current.stdout.trim() !== "main") {
      const checkout = runGitSafe(appDir, ["checkout", "main"]);
      if (checkout.returncode !== 0) {
        return { success: false, message: `Failed to switch to main: ${checkout.stdout}` };
      }
    }

    const result = runGitSafe(appDir, ["merge", branchName, "--no-ff", "-m", `Merge ${branchName} into main`]);
    if (result.returncode !== 0) {
      if (result.stdout.includes("CONFLICT")) {
        runGitSafe(appDir, ["merge", "--abort"]);
        return { success: false, message: "Merge conflict detected. Please resolve manually or rebase first." };
      }
      return { success: false, message: `Merge failed: ${result.stdout}` };
    }

    return { success: true, message: `Successfully merged ${branchName} into main` };
  } catch (e: any) {
    return { success: false, message: String(e) };
  }
}

/**
 * Run pending database migrations in the worktree using framework-appropriate commands.
 * Called after copying/cloning the main app's DB so the worktree branch's
 * schema changes (new tables, columns, etc.) are applied.
 */
function runMigrations(
  worktreeDir: string,
  techStack: TechStack
): { success: boolean; message: string } {
  const env = { ...process.env, HOME: os.homedir() };

  try {
    const envPrefix = buildEnvPrefix(worktreeDir);
    const run = (cmd: string) =>
      execSync(cmd, { shell: "bash", timeout: 60000, cwd: worktreeDir, env, stdio: ["pipe", "pipe", "pipe"] });

    switch (techStack.framework) {
      case "rails": {
        run(`${envPrefix} && cd "${worktreeDir}" && bundle exec rails db:migrate 2>&1`);
        return { success: true, message: "Rails migrations applied" };
      }
      case "django": {
        run(`${envPrefix} && cd "${worktreeDir}" && python manage.py migrate 2>&1`);
        return { success: true, message: "Django migrations applied" };
      }
      case "nextjs":
      case "express": {
        // Prisma migrate
        const prismaSchema = path.join(worktreeDir, "prisma", "schema.prisma");
        if (fs.existsSync(prismaSchema)) {
          run(`${envPrefix} && cd "${worktreeDir}" && npx prisma migrate deploy 2>&1`);
          return { success: true, message: "Prisma migrations applied" };
        }
        // Drizzle migrate
        const drizzleSchema = path.join(worktreeDir, "drizzle");
        if (fs.existsSync(drizzleSchema)) {
          run(`${envPrefix} && cd "${worktreeDir}" && npx drizzle-kit push 2>&1`);
          return { success: true, message: "Drizzle migrations applied" };
        }
        return { success: true, message: "No migration tool detected (skipped)" };
      }
      case "flask": {
        // Flask-Migrate / Alembic
        const migrationsDir = path.join(worktreeDir, "migrations");
        if (fs.existsSync(migrationsDir)) {
          run(`${envPrefix} && cd "${worktreeDir}" && flask db upgrade 2>&1`);
          return { success: true, message: "Flask migrations applied" };
        }
        return { success: true, message: "No migrations directory found (skipped)" };
      }
      default:
        return { success: true, message: "Unknown framework — migrations skipped" };
    }
  } catch (e: any) {
    const output = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
    return { success: false, message: `Migration failed: ${output.slice(0, 500)}` };
  }
}

/**
 * Reset the worktree database to a clean copy of the main app's database,
 * then re-run migrations so the worktree branch's schema changes are applied.
 * SQLite: re-copies .db files from the main app directory.
 * PostgreSQL: drops and re-clones from the original database.
 */
export function resetWorktreeDatabase(
  worktreeDir: string,
  appDir: string,
  techStack: TechStack
): { success: boolean; message: string } {
  try {
    if (techStack.database === "postgresql" && techStack.databaseName) {
      const taskIdMatch = worktreeDir.match(/-task-(\d+)\/?$/);
      if (!taskIdMatch) {
        return { success: false, message: "Cannot determine task ID from worktree directory" };
      }
      const taskId = parseInt(taskIdMatch[1], 10);
      // Guard against double-suffix: if databaseName was read from a patched
      // worktree database.yml, it already contains _task_N. Strip it first.
      const baseName = techStack.databaseName.replace(/_task_\d+$/, "");
      const worktreeDbName = getWorktreeDatabaseName(baseName, taskId);
      const teardown = teardownPostgresDatabase(worktreeDbName);
      if (!teardown.success) {
        return { success: false, message: `DB teardown failed: ${teardown.message}` };
      }
      const setup = setupPostgresDatabase(baseName, worktreeDbName);
      if (!setup.success) return setup;
    } else {
      copyDatabases(appDir, worktreeDir);
    }

    // Re-run migrations so the worktree branch's schema changes are applied
    const migrationResult = runMigrations(worktreeDir, techStack);
    if (!migrationResult.success) {
      return { success: true, message: `DB reset OK but migrations had issues: ${migrationResult.message}` };
    }

    return { success: true, message: `Database reset and migrations applied` };
  } catch (e: any) {
    return { success: false, message: `Database reset failed: ${String(e)}` };
  }
}

// Re-export runGitSafe for use in route handlers
export { runGitSafe };
