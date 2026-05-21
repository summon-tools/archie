import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Framework, TechStack } from "./techstack";

// --- Types ---

export interface ManifestProcess {
  name: string;
  command: string;
  /** If true, this is the primary web process that binds to $PORT */
  web?: boolean;
}

export interface AppManifest {
  app: { framework: string };
  install: { command: string };
  dev: {
    command: string;
    port_env?: string;
    strict_port?: boolean;
    health_path?: string;
    host_env?: string;
    host_value?: string;
  };
  /** Optional multi-process definition. When present, the runner starts all
   *  processes instead of just dev.command. The `web` process is the one that
   *  binds to $PORT and receives health checks. Non-web processes (asset
   *  watchers, background workers, etc.) are started alongside it.
   *  If omitted, the runner falls back to the single dev.command. */
  processes?: ManifestProcess[];
  worktree?: {
    prepare_command?: string;
  };
}

const ARCHIE_DIR = ".archie";
const MANIFEST_FILE = "app.yaml";

// --- Read / Write ---

export function readManifest(directory: string): AppManifest | null {
  const manifestPath = path.join(directory, ARCHIE_DIR, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    return yaml.load(content) as AppManifest;
  } catch {
    return null;
  }
}

export function writeManifest(directory: string, manifest: AppManifest): void {
  const dir = path.join(directory, ARCHIE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const content = yaml.dump(manifest, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), content, "utf-8");
}

export function manifestToYaml(manifest: AppManifest): string {
  return yaml.dump(manifest, { lineWidth: 120, noRefs: true });
}

// --- Generation ---

function pmRun(pm: string | null): string {
  switch (pm) {
    case "yarn": return "yarn";
    case "pnpm": return "pnpm";
    case "bun": return "bun";
    default: return "npm run";
  }
}

function pmInstall(pm: string | null): string {
  switch (pm) {
    case "yarn": return "yarn install";
    case "pnpm": return "pnpm install";
    case "bun": return "bun install";
    default: return "npm install";
  }
}

function hasPrisma(directory: string): boolean {
  return fs.existsSync(path.join(directory, "prisma", "schema.prisma"));
}

function hasFlaskMigrations(directory: string): boolean {
  return fs.existsSync(path.join(directory, "migrations"));
}

function hasAlembic(directory: string): boolean {
  return fs.existsSync(path.join(directory, "alembic.ini"));
}

function detectFastAPIAppTarget(directory?: string): string {
  if (!directory) return "main:app";

  const candidates = [
    { file: "main.py", target: "main:app" },
    { file: path.join("app", "main.py"), target: "app.main:app" },
    { file: path.join("src", "main.py"), target: "src.main:app" },
    { file: path.join("src", "app", "main.py"), target: "src.app.main:app" },
    { file: "app.py", target: "app:app" },
    { file: "api.py", target: "api:app" },
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(directory, candidate.file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      if (/\bFastAPI\s*\(/.test(content) || /\bfrom\s+fastapi\s+import\b/i.test(content)) {
        return candidate.target;
      }
    } catch {}
  }

  return "main:app";
}

function pythonInstallCommand(directory?: string): string {
  if (directory && fs.existsSync(path.join(directory, "requirements.txt"))) {
    return "pip install -r requirements.txt";
  }
  if (directory && fs.existsSync(path.join(directory, "pyproject.toml"))) {
    return "pip install -e .";
  }
  if (directory && fs.existsSync(path.join(directory, "Pipfile"))) {
    return "pip install pipenv && pipenv install --dev";
  }
  return "pip install -r requirements.txt";
}

export function generateManifest(stack: TechStack, port: number, directory?: string): AppManifest {
  const pm = stack.packageManager;

  switch (stack.framework) {
    case "rails": {
      const installParts = ["bundle install"];
      if (pm) installParts.push(`${pmInstall(pm)}`);

      // Build multi-process list from Procfile.dev if available
      let processes: ManifestProcess[] | undefined;
      if (stack.hasProcfile && stack.processes.length > 0) {
        processes = stack.processes.map((p) => ({
          name: p.name,
          command: p.command,
          ...(p.name === "web" ? { web: true } : {}),
        }));
        // If no process is explicitly named "web", mark the first one
        if (!processes.some((p) => p.web)) {
          processes[0].web = true;
        }
      }

      // Build prepare_command: db + asset compilation for worktrees
      const prepareParts = ["bundle exec rails db:prepare"];
      if (processes && processes.length > 0) {
        // Add one-shot asset build commands for non-web processes (js/css watchers)
        // The watchers keep assets updated, but we need an initial build
        for (const proc of processes) {
          if (proc.web) continue;
          // Convert watch commands to one-shot builds:
          // "yarn build --watch" → "yarn build"
          // "yarn run build:css --watch" → "yarn run build:css"
          const oneShot = proc.command.replace(/\s+--watch\b/, "");
          if (oneShot !== proc.command) {
            prepareParts.push(oneShot);
          }
        }
      }

      return {
        app: { framework: "rails" },
        install: { command: installParts.join(" && ") },
        dev: {
          command: `bundle exec rails server -p $PORT -b 0.0.0.0`,
          port_env: "PORT",
          strict_port: true,
          health_path: "/",
          host_env: "BINDING",
          host_value: "0.0.0.0",
        },
        processes,
        worktree: { prepare_command: prepareParts.join(" && ") },
      };
    }

    case "nextjs": {
      const prismaCmd = directory && hasPrisma(directory) ? "npx prisma migrate deploy" : undefined;
      return {
        app: { framework: "nextjs" },
        install: { command: pmInstall(pm) },
        dev: {
          command: `${pmRun(pm)} dev -p $PORT`,
          port_env: "PORT",
          strict_port: true,
          health_path: "/",
        },
        worktree: prismaCmd ? { prepare_command: prismaCmd } : undefined,
      };
    }

    case "django":
      return {
        app: { framework: "django" },
        install: { command: pythonInstallCommand(directory) },
        dev: {
          command: "python manage.py runserver 0.0.0.0:$PORT",
          port_env: "PORT",
          strict_port: true,
          health_path: "/",
        },
        worktree: { prepare_command: "python manage.py migrate" },
      };

    case "fastapi":
      return {
        app: { framework: "fastapi" },
        install: { command: pythonInstallCommand(directory) },
        dev: {
          command: `uvicorn ${detectFastAPIAppTarget(directory)} --host 0.0.0.0 --port $PORT`,
          port_env: "PORT",
          strict_port: true,
          health_path: "/",
        },
        worktree: directory && hasAlembic(directory) ? { prepare_command: "alembic upgrade head" } : undefined,
      };

    case "flask":
      return {
        app: { framework: "flask" },
        install: { command: pythonInstallCommand(directory) },
        dev: {
          command: "flask run --host 0.0.0.0 --port $PORT",
          port_env: "FLASK_RUN_PORT",
          strict_port: true,
          health_path: "/",
        },
        worktree: directory && hasFlaskMigrations(directory) ? { prepare_command: "flask db upgrade" } : undefined,
      };

    case "express":
      return {
        app: { framework: "express" },
        install: { command: pmInstall(pm) },
        dev: {
          command: `${pmRun(pm)} dev`,
          port_env: "PORT",
          strict_port: true,
          health_path: "/",
        },
      };

    case "vite":
      return {
        app: { framework: "vite" },
        install: { command: pmInstall(pm) },
        dev: {
          command: `${pmRun(pm)} dev --port $PORT --host`,
          port_env: "PORT",
          strict_port: true,
          health_path: "/",
        },
      };

    default:
      return {
        app: { framework: "unknown" },
        install: { command: pm ? pmInstall(pm) : "echo 'No install command detected'" },
        dev: {
          command: pm ? `${pmRun(pm)} dev` : "echo 'No dev command detected'",
          port_env: "PORT",
          strict_port: true,
          health_path: "/",
        },
      };
  }
}
