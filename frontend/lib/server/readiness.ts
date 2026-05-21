import { execSync } from "child_process";
import { getAllProviders } from "./agent/registry";
import { getInstallHint } from "./platform";

// --- Types ---

export interface ReadinessCheck {
  name: string;
  status: "ok" | "missing" | "outdated";
  version?: string;
  required: boolean;
  install_hint: string;
}

export interface ProviderReadiness {
  id: string;
  label: string;
  available: boolean;
  error?: string;
}

export interface SystemReadiness {
  tools: ReadinessCheck[];
  providers: ProviderReadiness[];
}

// --- Tool Checking ---

function checkTool(
  name: string,
  command: string,
  versionCommand: string,
  required: boolean,
  installHint: string
): ReadinessCheck {
  // For tools that aren't simple binaries (e.g. "npx playwright"),
  // skip `command -v` and run the version command directly.
  const isSimpleBinary = !command.includes(" ");

  if (isSimpleBinary) {
    try {
      execSync(`command -v ${command}`, {
        shell: "bash",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return { name, status: "missing", required, install_hint: installHint };
    }
  }

  try {
    const version = execSync(versionCommand, {
      shell: "bash",
      timeout: 10000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = version.match(/(\d+\.\d+[\.\d]*)/);
    return { name, status: "ok", version: match ? match[1] : version.slice(0, 30), required, install_hint: installHint };
  } catch {
    return isSimpleBinary
      ? { name, status: "ok", required, install_hint: installHint }
      : { name, status: "missing", required, install_hint: installHint };
  }
}

export function checkSystemTools(): ReadinessCheck[] {
  return [
    checkTool("git", "git", "git --version", true, getInstallHint("git")),
    checkTool("node", "node", "node --version", true, getInstallHint("node")),
    checkTool("ruby", "ruby", "ruby --version", false, getInstallHint("ruby")),
    checkTool("python", "python3", "python3 --version", false, getInstallHint("python3")),
    checkTool("ffmpeg", "ffmpeg", "ffmpeg -version 2>&1 | head -1", false, getInstallHint("ffmpeg")),
    checkTool("playwright", "npx playwright --version", "npx playwright --version 2>/dev/null", false, getInstallHint("playwright")),
    checkTool("gh", "gh", "gh --version", false, getInstallHint("gh")),
    checkTool("claude", "claude", "claude --version", true, getInstallHint("claude")),
  ];
}

export async function checkProviderReadiness(): Promise<ProviderReadiness[]> {
  const providers = getAllProviders();
  const results: ProviderReadiness[] = [];

  for (const provider of providers) {
    try {
      const available = await provider.isAvailable();
      results.push({
        id: provider.id,
        label: provider.label,
        available,
        error: available ? undefined : "Provider not available",
      });
    } catch (e: any) {
      results.push({
        id: provider.id,
        label: provider.label,
        available: false,
        error: e.message || "Check failed",
      });
    }
  }

  return results;
}

export async function checkSystemReadiness(): Promise<SystemReadiness> {
  const tools = checkSystemTools();
  const providers = await checkProviderReadiness();
  return { tools, providers };
}

// --- App-Level Readiness ---

export interface AppReadinessCheck {
  name: string;
  status: "ok" | "missing";
  install_hint: string;
}

export function checkAppReadiness(framework: string): AppReadinessCheck[] {
  const checks: AppReadinessCheck[] = [];

  switch (framework) {
    case "rails":
      checks.push(
        checkAppTool("ruby", "ruby", getInstallHint("ruby")),
        checkAppTool("bundler", "bundle", getInstallHint("bundler")),
        checkAppTool("node", "node", getInstallHint("node")),
      );
      break;
    case "nextjs":
    case "express":
    case "vite":
      checks.push(
        checkAppTool("node", "node", getInstallHint("node")),
      );
      break;
    case "django":
    case "fastapi":
    case "flask":
      checks.push(
        checkAppTool("python3", "python3", getInstallHint("python3")),
        checkAppTool("pip", "pip3", getInstallHint("pip3")),
      );
      break;
    default:
      checks.push(
        checkAppTool("node", "node", getInstallHint("node")),
      );
  }

  return checks;
}

function checkAppTool(name: string, command: string, installHint: string): AppReadinessCheck {
  try {
    execSync(`command -v ${command}`, {
      shell: "bash",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { name, status: "ok", install_hint: installHint };
  } catch {
    return { name, status: "missing", install_hint: installHint };
  }
}
