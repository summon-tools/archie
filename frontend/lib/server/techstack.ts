import fs from "fs";
import path from "path";
import { getScriptWritePath } from "./app-paths";

// --- Types ---

export type Framework = "rails" | "nextjs" | "express" | "django" | "flask" | "vite" | "unknown";
export type PackageManager = "yarn" | "npm" | "pnpm" | "bun" | null;
export type BundleManager = "bundle" | "pip" | null;
export type DatabaseAdapter = "postgresql" | "sqlite" | "mysql" | "none";

export interface TechStack {
  framework: Framework;
  packageManager: PackageManager;
  bundleManager: BundleManager;
  database: DatabaseAdapter;
  databaseName: string | null;
  hasProcfile: boolean;
  processes: { name: string; command: string }[];
}

// --- Parsers ---

export function parseProcfile(filePath: string): { name: string; command: string }[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  const processes: { name: string; command: string }[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const name = trimmed.slice(0, colonIdx).trim();
    const command = trimmed.slice(colonIdx + 1).trim();
    if (name && command) {
      processes.push({ name, command });
    }
  }
  return processes;
}

export function parseDatabaseYml(filePath: string): { adapter: DatabaseAdapter; database: string | null } {
  if (!fs.existsSync(filePath)) return { adapter: "none", database: null };
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  let inDevelopment = false;
  let adapter: DatabaseAdapter = "none";
  let database: string | null = null;

  for (const line of lines) {
    // Check for top-level section headers (no leading whitespace, ends with colon)
    if (/^\S/.test(line) && line.trim().endsWith(":")) {
      inDevelopment = line.trim() === "development:";
      continue;
    }
    if (!inDevelopment) continue;

    const adapterMatch = line.match(/^\s+adapter:\s*(\S+)/);
    if (adapterMatch) {
      const val = adapterMatch[1];
      if (val === "postgresql") adapter = "postgresql";
      else if (val === "sqlite3") adapter = "sqlite";
      else if (val === "mysql2") adapter = "mysql";
    }

    const dbMatch = line.match(/^\s+database:\s*(\S+)/);
    if (dbMatch) {
      database = dbMatch[1];
    }
  }

  // If development section uses <<: *default, also check default section
  if (adapter === "none") {
    for (const line of lines) {
      const adapterMatch = line.match(/^\s+adapter:\s*(\S+)/);
      if (adapterMatch) {
        const val = adapterMatch[1];
        if (val === "postgresql") { adapter = "postgresql"; break; }
        else if (val === "sqlite3") { adapter = "sqlite"; break; }
        else if (val === "mysql2") { adapter = "mysql"; break; }
      }
    }
  }

  return { adapter, database };
}

// --- Detection ---

export function detectTechStack(projectDir: string): TechStack {
  const framework = detectFramework(projectDir);
  const packageManager = detectPackageManager(projectDir);
  const bundleManager = detectBundleManager(projectDir);
  const { adapter: database, database: databaseName } = detectDatabase(projectDir, framework);

  const procfileDev = path.join(projectDir, "Procfile.dev");
  const procfile = path.join(projectDir, "Procfile");
  let processes: { name: string; command: string }[] = [];
  let hasProcfile = false;

  if (fs.existsSync(procfileDev)) {
    processes = parseProcfile(procfileDev);
    hasProcfile = true;
  } else if (fs.existsSync(procfile)) {
    processes = parseProcfile(procfile);
    hasProcfile = true;
  }

  return { framework, packageManager, bundleManager, database, databaseName, hasProcfile, processes };
}

function detectFramework(dir: string): Framework {
  // Rails: Gemfile with rails + bin/rails
  const gemfile = path.join(dir, "Gemfile");
  if (fs.existsSync(gemfile) && fs.existsSync(path.join(dir, "bin", "rails"))) {
    try {
      const content = fs.readFileSync(gemfile, "utf-8");
      if (/gem\s+['"]rails['"]/.test(content)) return "rails";
    } catch {}
  }

  // Next.js
  if (
    fs.existsSync(path.join(dir, "next.config.js")) ||
    fs.existsSync(path.join(dir, "next.config.mjs")) ||
    fs.existsSync(path.join(dir, "next.config.ts"))
  ) {
    return "nextjs";
  }

  // Django
  const managePy = path.join(dir, "manage.py");
  if (fs.existsSync(managePy)) {
    const reqFile = path.join(dir, "requirements.txt");
    const pipfile = path.join(dir, "Pipfile");
    try {
      if (fs.existsSync(reqFile) && fs.readFileSync(reqFile, "utf-8").toLowerCase().includes("django")) return "django";
      if (fs.existsSync(pipfile) && fs.readFileSync(pipfile, "utf-8").toLowerCase().includes("django")) return "django";
    } catch {}
  }

  // Vite
  if (
    fs.existsSync(path.join(dir, "vite.config.js")) ||
    fs.existsSync(path.join(dir, "vite.config.ts")) ||
    fs.existsSync(path.join(dir, "vite.config.mjs"))
  ) {
    return "vite";
  }

  // Express
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps["express"]) return "express";
    } catch {}
  }

  // Flask
  if (fs.existsSync(managePy) || fs.existsSync(path.join(dir, "app.py"))) {
    const reqFile = path.join(dir, "requirements.txt");
    try {
      if (fs.existsSync(reqFile) && fs.readFileSync(reqFile, "utf-8").toLowerCase().includes("flask")) return "flask";
    } catch {}
  }

  return "unknown";
}

function detectPackageManager(dir: string): PackageManager {
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock"))) return "bun";
  if (fs.existsSync(path.join(dir, "package-lock.json")) || fs.existsSync(path.join(dir, "package.json"))) return "npm";
  return null;
}

function detectBundleManager(dir: string): BundleManager {
  if (fs.existsSync(path.join(dir, "Gemfile"))) return "bundle";
  if (fs.existsSync(path.join(dir, "requirements.txt")) || fs.existsSync(path.join(dir, "Pipfile"))) return "pip";
  return null;
}

function detectDatabase(dir: string, framework: Framework): { adapter: DatabaseAdapter; database: string | null } {
  // Try config/database.yml first (Rails convention)
  const dbYml = path.join(dir, "config", "database.yml");
  if (fs.existsSync(dbYml)) {
    const result = parseDatabaseYml(dbYml);
    if (result.adapter !== "none") return result;
  }

  // Fallback: check Gemfile for database gems
  const gemfile = path.join(dir, "Gemfile");
  if (fs.existsSync(gemfile)) {
    try {
      const content = fs.readFileSync(gemfile, "utf-8");
      if (/gem\s+['"]pg['"]/.test(content)) return { adapter: "postgresql", database: null };
      if (/gem\s+['"]sqlite3['"]/.test(content)) return { adapter: "sqlite", database: null };
      if (/gem\s+['"]mysql2['"]/.test(content)) return { adapter: "mysql", database: null };
    } catch {}
  }

  return { adapter: "none", database: null };
}

// --- Script Generation ---

export function getWorktreeDatabaseName(originalDbName: string, taskId: number): string {
  return `${originalDbName}_task_${taskId}`;
}

export function generatePreviewStartScript(stack: TechStack, worktreeDir: string, port: number): string {
  const scriptPath = getScriptWritePath(worktreeDir, "preview-start.sh");
  const scriptDir = path.dirname(scriptPath);
  fs.mkdirSync(scriptDir, { recursive: true });

  let script: string;
  switch (stack.framework) {
    case "rails":
      script = generateRailsStartScript(stack, worktreeDir, port);
      break;
    case "nextjs":
      script = generateNextjsStartScript(stack, worktreeDir, port);
      break;
    default:
      // Return empty — caller should fall back to patchStartScript
      return "";
  }

  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

function generateRailsStartScript(stack: TechStack, worktreeDir: string, port: number): string {
  const installCmd = buildInstallCommand(stack.packageManager, worktreeDir);
  const nonWebProcesses = stack.processes.filter((p) => p.name !== "web");

  let watcherSection = "";
  for (const proc of nonWebProcesses) {
    watcherSection += `
# Start ${proc.name} process
nohup ${proc.command} > .archie/logs/${proc.name}.log 2>&1 &
echo $! > .archie/pids/${proc.name}.pid
`;
  }

  return `#!/bin/bash
set -e

# Source nvm if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Ruby version managers — source whichever is installed
# rbenv
if [ -d "$HOME/.rbenv" ]; then
  export PATH="$HOME/.rbenv/bin:$HOME/.rbenv/shims:$PATH"
  eval "$(rbenv init - 2>/dev/null)" || true
fi
# RVM — source first, then cd to trigger .ruby-version hook
if [ -s "$HOME/.rvm/scripts/rvm" ]; then
  source "$HOME/.rvm/scripts/rvm" 2>/dev/null || true
fi
# asdf
if [ -s "$HOME/.asdf/asdf.sh" ]; then
  source "$HOME/.asdf/asdf.sh" 2>/dev/null || true
fi

# cd into project AFTER version managers are loaded so .ruby-version is respected
cd "${worktreeDir}"

# Install Ruby dependencies
bundle check > /dev/null 2>&1 || bundle install

# Install JS dependencies
${installCmd}

# Create directories
mkdir -p .archie/logs .archie/pids

# Kill any process already using our port
if command -v lsof &>/dev/null; then
  EXISTING_PID=$(lsof -ti :${port} 2>/dev/null | head -1)
  if [ -n "$EXISTING_PID" ]; then
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 1
  fi
elif command -v ss &>/dev/null; then
  EXISTING_PID=$(ss -tlnp "sport = :${port}" 2>/dev/null | grep -oP 'pid=\\K[0-9]+' | head -1)
  if [ -n "$EXISTING_PID" ]; then
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 1
  fi
fi

# Build assets
yarn build 2>/dev/null || true
yarn build:css 2>/dev/null || true
${watcherSection}
# Start Rails server (BINDING=0.0.0.0 needed because Puma in dev mode defaults to localhost)
PORT=${port} BINDING=0.0.0.0 nohup bundle exec rails server -p ${port} -b 0.0.0.0 > .archie/logs/web.log 2>&1 &
echo $! > .archie/pids/web.pid

echo "Started Rails app on port ${port}"
`;
}

function generateNextjsStartScript(stack: TechStack, worktreeDir: string, port: number): string {
  const pm = stack.packageManager || "npm";
  const installCmd = buildInstallCommand(stack.packageManager, worktreeDir);
  const runCmd = pm === "yarn" ? "yarn dev" : pm === "pnpm" ? "pnpm dev" : pm === "bun" ? "bun dev" : "npm run dev";

  return `#!/bin/bash
set -e
cd "${worktreeDir}"

# Source nvm if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Install dependencies
${installCmd}

# Create directories
mkdir -p .archie/logs .archie/pids

# Start Next.js dev server
PORT=${port} nohup ${runCmd} -p ${port} > .archie/logs/app.log 2>&1 &
echo $! > .archie/pids/app.pid

echo "Started Next.js app on port ${port}"
`;
}

function buildInstallCommand(pm: PackageManager, dir: string): string {
  switch (pm) {
    case "yarn":
      return `if [ ! -d "node_modules" ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then yarn install --ignore-engines; fi`;
    case "pnpm":
      return `if [ ! -d "node_modules" ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then pnpm install; fi`;
    case "bun":
      return `if [ ! -d "node_modules" ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then bun install; fi`;
    case "npm":
      return `if [ ! -d "node_modules" ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then npm install; fi`;
    default:
      return "# No package manager detected";
  }
}

export function generatePreviewStopScript(stack: TechStack, worktreeDir: string, port: number): string {
  const scriptPath = getScriptWritePath(worktreeDir, "preview-stop.sh");
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, generateStopScriptContent(worktreeDir, port), { mode: 0o755 });
  return scriptPath;
}

function generateStopScriptContent(dir: string, port: number): string {
  return `#!/bin/bash
cd "${dir}"

# Kill all managed processes from .archie/pids/
if [ -d ".archie/pids" ]; then
  for PIDFILE in .archie/pids/*.pid; do
    [ -f "$PIDFILE" ] || continue
    PID=$(cat "$PIDFILE" 2>/dev/null)
    NAME=$(basename "$PIDFILE" .pid)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null
      echo "Stopped $NAME (PID $PID)"
    fi
    rm -f "$PIDFILE"
  done
fi

# Fallback: kill any process on the port (cross-platform)
if command -v lsof &>/dev/null; then
  EXISTING_PID=$(lsof -ti :${port} 2>/dev/null | head -1)
  if [ -n "$EXISTING_PID" ]; then
    kill "$EXISTING_PID" 2>/dev/null
    echo "Killed leftover process on port ${port} (PID $EXISTING_PID)"
  fi
elif command -v ss &>/dev/null; then
  EXISTING_PID=$(ss -tlnp "sport = :${port}" 2>/dev/null | grep -oP 'pid=\\K[0-9]+' | head -1)
  if [ -n "$EXISTING_PID" ]; then
    kill "$EXISTING_PID" 2>/dev/null
    echo "Killed leftover process on port ${port} (PID $EXISTING_PID)"
  fi
fi

# Clean up Rails server.pid if present
rm -f tmp/pids/server.pid 2>/dev/null
`;
}

