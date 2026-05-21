import fs from "fs";
import path from "path";
import type { Framework, TechStack } from "./techstack";
import type { AppManifest } from "./manifest";
import { readManifest, manifestToYaml, generateManifest } from "./manifest";

export interface SetupToolContext {
  appName: string;
  directory: string;
  port: number;
  stack: TechStack;
  manifest?: AppManifest;
}

const FRAMEWORK_TO_TEMPLATE: Record<Framework, string> = {
  rails: "rails.md",
  nextjs: "nextjs.md",
  django: "django.md",
  fastapi: "fastapi.md",
  flask: "flask.md",
  express: "express.md",
  vite: "vite.md",
  unknown: "generic.md",
};

function formatProcesses(stack: TechStack): string {
  if (stack.processes.length === 0) return "none";
  return stack.processes.map((p) => `${p.name}: ${p.command}`).join(", ");
}

function databaseSetupHint(stack: TechStack): string {
  if (stack.framework !== "fastapi" || stack.database !== "postgresql" || stack.databaseName) {
    return "";
  }

  return `
## Worktree database setup warning
Archie detected PostgreSQL dependencies, but it could not find a concrete database URL or database name. Before finishing setup, create or copy a project \`.env\` file and make sure the app reads a full PostgreSQL URL from \`DATABASE_URL\` or the app's existing DB URL env var.

Do not hardcode the database URL in \`.archie/app.yaml\` or the uvicorn command. Future task worktrees need the DB URL in env configuration before the worktree is created so Archie can clone it into an isolated per-task database.`;
}

export function buildSetupToolPrompt(ctx: SetupToolContext): string {
  const templateFile = FRAMEWORK_TO_TEMPLATE[ctx.stack.framework];
  const templatePath = path.join(process.cwd(), "lib", "server", "skills", "setup", templateFile);
  let template = fs.readFileSync(templatePath, "utf-8");

  // Get or generate manifest
  const manifest = ctx.manifest || readManifest(ctx.directory) || generateManifest(ctx.stack, ctx.port, ctx.directory);
  const manifestYaml = manifestToYaml(manifest);

  const pm = ctx.stack.packageManager || "npm";

  const replacements: Record<string, string> = {
    "{{APP_NAME}}": ctx.appName,
    "{{DIRECTORY}}": ctx.directory,
    "{{PORT}}": String(ctx.port),
    "{{PACKAGE_MANAGER}}": ctx.stack.packageManager || "none",
    "{{DATABASE}}": ctx.stack.database,
    "{{DATABASE_NAME}}": ctx.stack.databaseName || "none",
    "{{DATABASE_SETUP_HINT}}": databaseSetupHint(ctx.stack),
    "{{HAS_PROCFILE}}": String(ctx.stack.hasProcfile),
    "{{PROCESSES}}": formatProcesses(ctx.stack),
    "{{MANIFEST_YAML}}": manifestYaml,
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    template = template.replaceAll(placeholder, value);
  }

  return template;
}
