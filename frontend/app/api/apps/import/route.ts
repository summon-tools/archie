import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { getProjectsDir } from "@/lib/server/config";
import * as gitManager from "@/lib/server/git";
import { detectTechStack } from "@/lib/server/techstack";
import { buildSetupToolPrompt } from "@/lib/server/tool-loader";
import * as dal from "@/lib/server/dal";
import { importAppSchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";
import { allocateFreePort } from "@/lib/server/runner";
import { generateManifest, writeManifest } from "@/lib/server/manifest";
import { checkAppReadiness } from "@/lib/server/readiness";

const SETUP_BRANCH = "setup-archie";

const ARCHIE_README = `# .archie

This directory contains Archie's configuration and project context.

## Contents

| Path | Tracked | Purpose |
|------|---------|---------|
| \`app.yaml\` | Yes | **Runtime manifest** — defines how Archie installs, starts, and manages this app (port, commands, processes). This is the main configuration contract. |
| \`spec/\` | Yes | **Living specification** — project documentation that Archie references when working on tasks. Edit these to guide AI behavior. |
| \`skills/\` | Yes | **Team conventions & playbooks** — reusable instructions (e.g. "how we write tests", "deploy checklist") that Archie follows. |
| \`logs/\` | No | Runtime process output logs (git-ignored). |
| \`pids/\` | No | Process ID files for lifecycle management (git-ignored). |
| \`videos/\` | No | Demo recordings and walkthroughs (git-ignored). |
| \`context-files/\` | No | Temporary read-only copies of uploaded files for agent context (git-ignored). |

## How it works

- **\`app.yaml\`** is the only required file. It tells Archie how to run your project locally.
- **\`spec/\`** and **\`skills/\`** are optional but help Archie make better decisions when working on your code.
- **\`logs/\`**, **\`pids/\`**, **\`videos/\`**, and **\`context-files/\`** are runtime-only and excluded from version control.

## Learn more

See the Archie documentation for details on manifest format, spec authoring, and skills.
`;

/**
 * Writes .archie/README.md explaining the folder structure.
 */
function writeArchieReadme(directory: string): void {
  const readmePath = path.join(directory, ".archie", "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.mkdirSync(path.join(directory, ".archie"), { recursive: true });
    fs.writeFileSync(readmePath, ARCHIE_README, "utf-8");
  }
}

/**
 * Creates the setup branch, writes the manifest there, and commits it.
 * Main branch stays clean — .archie/ only exists on the setup branch.
 * Returns to the setup branch (not main) so the agent works there.
 */
function setupBranchWithManifest(
  directory: string,
  manifest: ReturnType<typeof generateManifest>,
): boolean {
  try {
    // Create and checkout a new branch for setup work
    execSync(`git checkout -b ${SETUP_BRANCH}`, {
      cwd: directory,
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Ensure .archie runtime dirs are gitignored before any commits
    gitManager.ensureGitignore(directory);

    // Write manifest and README on the setup branch
    writeManifest(directory, manifest);
    writeArchieReadme(directory);

    // Commit the manifest + gitignore updates so they're tracked on this branch
    execSync(`git add .archie .gitignore && git commit -m "Add Archie manifest"`, {
      cwd: directory,
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return true;
  } catch {
    // If branch creation failed (e.g. already exists), try checking it out
    try {
      execSync(`git checkout ${SETUP_BRANCH}`, {
        cwd: directory,
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // Ensure .archie runtime dirs are gitignored
      gitManager.ensureGitignore(directory);
      // Write manifest and README if not already there
      writeManifest(directory, manifest);
      writeArchieReadme(directory);
      execSync(`git add .archie .gitignore && git diff --cached --quiet || git commit -m "Add Archie manifest"`, {
        cwd: directory,
        timeout: 10000,
        shell: "bash",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function POST(request: NextRequest) {
  let authUser;
  try {
    authUser = await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  try {
    const body = await request.json();

    // Support both github_url and local_path
    const localPath = body.local_path as string | undefined;

    if (localPath) {
      // --- Local directory import ---
      if (!localPath.startsWith("/")) {
        return NextResponse.json(
          { detail: "local_path must be an absolute path" },
          { status: 400 }
        );
      }
      if (!fs.existsSync(localPath)) {
        return NextResponse.json(
          { detail: `Directory not found: ${localPath}` },
          { status: 404 }
        );
      }
      if (!fs.existsSync(path.join(localPath, ".git"))) {
        return NextResponse.json(
          { detail: "Directory is not a git repository" },
          { status: 400 }
        );
      }

      // Check if this directory is already imported
      const existingApp = dal.getAppByDirectory(localPath);
      if (existingApp) {
        const response = dal.buildAppResponse(existingApp);
        return NextResponse.json(
          { app: response, detail: "This project is already imported" },
          { status: 409 }
        );
      }

      const repoName = path.basename(localPath);
      const directory = localPath;

      let description = "";
      const packageJsonPath = path.join(directory, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
          description = packageJson.description || "";
        } catch {}
      }

      // Dynamically allocate a free port
      const port = await allocateFreePort();

      const app = dal.createApp({
        name: repoName,
        port,
        description,
        directory,
        github_repo: "",
        owner_user_id: authUser.id,
      });
      const appId = app.id;

      // Seed automation defaults (RFC 23)
      try {
        const { seedAutomationDefaults } = await import("@/lib/server/automations/seed");
        seedAutomationDefaults(appId);
      } catch { /* best effort */ }

      // Detect tech stack and generate manifest
      const stack = detectTechStack(directory);
      const manifest = generateManifest(stack, port, directory);

      // Create setup branch and commit manifest there — main stays clean
      setupBranchWithManifest(directory, manifest);

      const toolPrompt = buildSetupToolPrompt({
        appName: repoName,
        directory,
        port,
        stack,
      });

      // Create conversation + work item for setup task
      const conversation = dal.createConversation({
        app_id: appId,
        kind: "task",
        title: `Setup ${repoName}`,
        created_by: authUser.id,
      });
      const workItem = dal.createWorkItem({
        app_id: appId,
        primary_conversation_id: conversation.id,
        title: `Setup ${repoName}`,
        summary: toolPrompt,
        kind: "setup",
        created_by: authUser.id,
      });

      // Store the branch name so the UI can show diff/PR controls
      dal.ensureWorkItemEnv(workItem.id);
      dal.updateWorkItemEnv(workItem.id, { branch_name: SETUP_BRANCH });

      // Save the initial user message so it shows in the conversation
      dal.createMessage({
        conversation_id: conversation.id,
        role: "user",
        body_md: "Please set up this project.",
        author_user_id: authUser.id,
      });

      // Check readiness — surface missing tools to the user
      const readiness = checkAppReadiness(stack.framework);
      const missingTools = readiness.filter((r) => r.status === "missing");

      const response = dal.buildAppResponse(app);

      return NextResponse.json(
        {
          app: response,
          work_item_id: workItem.id,
          conversation_id: conversation.id,
          setup: {
            framework: stack.framework,
            packageManager: stack.packageManager,
            database: stack.database,
          },
          readiness: {
            checks: readiness,
            missing: missingTools,
            ready: missingTools.length === 0,
          },
        },
        { status: 201 }
      );
    }

    // --- GitHub URL import ---
    const parsed = importAppSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: formatZodError(parsed.error) },
        { status: 400 }
      );
    }
    const { github_url } = parsed.data;

    // Check if this repo is already imported (by URL or SSH equivalent)
    const sshUrlCheck = gitManager.normalizeGithubUrl(github_url);
    const existingByRepo = dal.getAppByGithubRepo(sshUrlCheck) || dal.getAppByGithubRepo(github_url);
    if (existingByRepo) {
      const response = dal.buildAppResponse(existingByRepo);
      return NextResponse.json(
        { app: response, detail: "This repository is already imported" },
        { status: 409 }
      );
    }

    const repoName = gitManager.extractRepoName(github_url);
    if (!repoName) {
      return NextResponse.json(
        { detail: "Could not extract repository name from URL" },
        { status: 400 }
      );
    }

    const slug = slugify(repoName);
    const projectsDir = getProjectsDir();
    const directory = path.join(projectsDir, slug);

    if (fs.existsSync(directory)) {
      return NextResponse.json(
        { detail: `Directory already exists: ${directory}` },
        { status: 409 }
      );
    }

    const cloneResult = gitManager.cloneRepo(github_url, directory);
    if (!cloneResult.success) {
      return NextResponse.json(
        { detail: cloneResult.message },
        { status: 400 }
      );
    }

    let description = "";
    const packageJsonPath = path.join(directory, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        description = packageJson.description || "";
      } catch {}
    }

    // Dynamically allocate a free port
    const port = await allocateFreePort();

    const sshUrl = cloneResult.ssh_url || gitManager.normalizeGithubUrl(github_url);

    const app = dal.createApp({
      name: repoName,
      port,
      description,
      directory,
      github_repo: sshUrl,
      owner_user_id: authUser.id,
    });
    const appId = app.id;

    // Seed automation defaults (RFC 23)
    try {
      const { seedAutomationDefaults } = await import("@/lib/server/automations/seed");
      seedAutomationDefaults(appId);
    } catch { /* best effort */ }

    // Detect tech stack and generate manifest
    const stack = detectTechStack(directory);
    const manifest = generateManifest(stack, port, directory);

    // Create setup branch and commit manifest there — main stays clean
    setupBranchWithManifest(directory, manifest);

    const toolPrompt = buildSetupToolPrompt({
      appName: repoName,
      directory,
      port,
      stack,
    });

    // Create conversation + work item for bootstrap task
    const conversation = dal.createConversation({
      app_id: appId,
      kind: "task",
      title: `Setup ${repoName}`,
      created_by: authUser.id,
    });
    const workItem = dal.createWorkItem({
      app_id: appId,
      primary_conversation_id: conversation.id,
      title: `Setup ${repoName}`,
      summary: toolPrompt,
      kind: "setup",
      created_by: authUser.id,
    });

    // Store the branch name so the UI can show diff/PR controls
    dal.ensureWorkItemEnv(workItem.id);
    dal.updateWorkItemEnv(workItem.id, { branch_name: SETUP_BRANCH });

    // Save the initial user message so it shows in the conversation
    dal.createMessage({
      conversation_id: conversation.id,
      role: "user",
      body_md: "Please set up this project.",
      author_user_id: authUser.id,
    });

    // Check readiness — surface missing tools to the user
    const readiness = checkAppReadiness(stack.framework);
    const missingTools = readiness.filter((r) => r.status === "missing");

    const response = dal.buildAppResponse(app);

    return NextResponse.json(
      {
        app: response,
        work_item_id: workItem.id,
        setup: {
          framework: stack.framework,
          packageManager: stack.packageManager,
          database: stack.database,
        },
        readiness: {
          checks: readiness,
          missing: missingTools,
          ready: missingTools.length === 0,
        },
      },
      { status: 201 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to import app" },
      { status: 500 }
    );
  }
}
