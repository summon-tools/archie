import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/server/db";
import { getAuthUser, requireAdmin, AuthError, ForbiddenError } from "@/lib/server/auth";
import { filterAppsForUser } from "@/lib/server/route-utils";
import { getProjectsDir } from "@/lib/server/config";
import * as dal from "@/lib/server/dal";
import { createAppSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";
import { indexApp } from "@/lib/server/knowledge/indexer";
import { allocateFreePort } from "@/lib/server/runner";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCreationPrompt(
  name: string,
  description: string,
  directory: string,
  port: number
): string {
  return `You are building a new web application called "${name}".

Description: ${description}

IMPORTANT REQUIREMENTS:
1. Create the application in the directory: ${directory}
2. The application MUST run on port ${port}
3. You MUST create a \`.archie/app.yaml\` manifest file in the project directory

The manifest format (create at .archie/app.yaml):
\`\`\`yaml
app:
  framework: <detected_framework>  # e.g. nextjs, rails, express, vite, django, fastapi, flask
install:
  command: <install_command>        # e.g. "npm install"
dev:
  command: <dev_command>            # e.g. "npm run dev -p $PORT"
  port_env: PORT                   # env var name for port (default: PORT)
  strict_port: true                # fail if port unavailable
  health_path: /                   # endpoint to check for readiness
  host_env: BINDING                # optional: env var for host binding (e.g. Rails)
  host_value: 0.0.0.0             # optional: host value
worktree:
  prepare_command: <migration_cmd> # optional: run in worktree previews
\`\`\`

CRITICAL RULES:
- Do NOT create start.sh or stop.sh — the manifest is the only runtime contract
- The app MUST bind to exactly port ${port} via the PORT env var
- The dev.command should use $PORT (literal) which will be replaced at runtime
- For Vite: set server.strictPort = true in vite.config
- For Next.js: use "-p $PORT" in the dev command
- For Express/Node: always use process.env.PORT, never hardcode
- For Rails: set host_env to BINDING and host_value to 0.0.0.0
- For FastAPI: use uvicorn with --host 0.0.0.0 --port $PORT

Build a complete, working application based on the description provided.
Initialize a git repository and make an initial commit.`;
}

export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getAuthUser>>;
  try {
    user = await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  try {
    const apps = filterAppsForUser(user, dal.getApps());
    const results = apps.map((app) => dal.buildAppResponse(app));
    return NextResponse.json({ apps: results });
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to list apps" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let admin;
  try {
    admin = await requireAdmin(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ detail: e.message }, { status: 403 });
    }
    throw e;
  }

  try {
    const body = await request.json();
    const parsed = createAppSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: formatZodError(parsed.error) },
        { status: 400 }
      );
    }
    const { name, description } = parsed.data;

    const slug = slugify(name);
    if (!slug) {
      return NextResponse.json(
        { detail: "App name must contain valid characters" },
        { status: 400 }
      );
    }

    const projectsDir = getProjectsDir();
    const directory = path.join(projectsDir, slug);

    if (fs.existsSync(directory)) {
      return NextResponse.json(
        { detail: `Directory already exists: ${directory}` },
        { status: 409 }
      );
    }

    // Dynamically allocate a free port
    const port = await allocateFreePort();

    // Create the directory
    fs.mkdirSync(directory, { recursive: true });

    // Insert app record via DAL
    const app = dal.createApp({
      name,
      port,
      description: (description || "").trim(),
      directory,
      github_repo: "",
    });
    const appId = app.id;

    // Seed automation defaults for this app (RFC 23)
    try {
      const { seedAutomationDefaults } = await import("@/lib/server/automations/seed");
      seedAutomationDefaults(appId);
    } catch { /* best effort */ }

    // Build the creation prompt
    const prompt = buildCreationPrompt(
      name,
      (description || "").trim(),
      directory,
      port
    );

    // Create bootstrap conversation + work item
    const conversation = dal.createConversation({
      app_id: appId,
      kind: "task",
      title: `Build ${name}`,
      created_by: admin.id,
    });
    const workItem = dal.createWorkItem({
      app_id: appId,
      primary_conversation_id: conversation.id,
      title: `Build ${name}`,
      summary: prompt,
      created_by: admin.id,
    });

    const response = dal.buildAppResponse(app);

    // Fire-and-forget: index the app directory for knowledge
    indexApp(appId, directory).catch(() => {});

    return NextResponse.json(
      { app: response, work_item_id: workItem.id },
      { status: 201 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to create app" },
      { status: 500 }
    );
  }
}
