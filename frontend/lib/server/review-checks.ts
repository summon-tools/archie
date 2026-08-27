import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const CHECK_TIMEOUT_MS = 120000;
const MAX_OUTPUT_CHARS = 12000;

export interface ReviewCheckResult {
  name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  exit_code: number | null;
  output: string;
  duration_ms: number;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const runtimeRoot = path.dirname(path.dirname(process.execPath));
  return {
    PATH: `${path.join(runtimeRoot, "bin")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    CI: "true",
    NODE_ENV: "test",
    LANG: process.env.LANG || "C.UTF-8",
  };
}

function runCommand(name: string, command: string, args: string[], cwd: string): ReviewCheckResult {
  const startedAt = Date.now();
  try {
    const output = execFileSync(command, args, {
      cwd,
      env: safeEnvironment(),
      timeout: CHECK_TIMEOUT_MS,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      name,
      command: [command, ...args].join(" "),
      status: "passed",
      exit_code: 0,
      output: output.slice(-MAX_OUTPUT_CHARS),
      duration_ms: Date.now() - startedAt,
    };
  } catch (error: any) {
    const output = `${error.stdout?.toString() || ""}${error.stderr?.toString() || ""}`;
    return {
      name,
      command: [command, ...args].join(" "),
      status: "failed",
      exit_code: typeof error.status === "number" ? error.status : null,
      output: output.slice(-MAX_OUTPUT_CHARS),
      duration_ms: Date.now() - startedAt,
    };
  }
}

function sandboxString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function macOsSandboxProfile(worktreeDir: string, scratchDir: string): string {
  const readableRoots = [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/opt/homebrew",
    "/usr/local",
    "/private/etc",
    "/private/var/db/timezone",
    path.dirname(path.dirname(process.execPath)),
    worktreeDir,
    fs.realpathSync(worktreeDir),
    scratchDir,
    fs.realpathSync(scratchDir),
  ];
  const writableRoots = [worktreeDir, fs.realpathSync(worktreeDir), scratchDir, fs.realpathSync(scratchDir)];
  const readRules = [...new Set(readableRoots)].map((root) => `(subpath "${sandboxString(root)}")`).join(" ");
  const writeRules = [...new Set(writableRoots)].map((root) => `(subpath "${sandboxString(root)}")`).join(" ");
  return `(version 1)
    (deny default)
    (allow process*)
    (allow sysctl-read)
    (allow file-read-metadata)
    (allow file-read* ${readRules})
    (allow file-write* ${writeRules})
    (deny network*)`;
}

function skippedCheck(name: string, command: string, message: string, startedAt = Date.now()): ReviewCheckResult {
  return {
    name,
    command,
    status: "skipped",
    exit_code: null,
    output: message,
    duration_ms: Date.now() - startedAt,
  };
}

function runSandboxedPackageScript(
  name: string,
  command: string,
  args: string[],
  cwd: string,
): ReviewCheckResult {
  const startedAt = Date.now();
  const displayCommand = [command, ...args].join(" ");
  if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec")) {
    return skippedCheck(
      name,
      displayCommand,
      "Package script skipped because a supported local execution sandbox is unavailable.",
      startedAt,
    );
  }

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "archie-review-checks-"));
  try {
    const output = execFileSync("/usr/bin/sandbox-exec", [
      "-p",
      macOsSandboxProfile(cwd, scratchDir),
      command,
      ...args,
    ], {
      cwd,
      env: {
        ...safeEnvironment(),
        HOME: scratchDir,
        TMPDIR: scratchDir,
        XDG_CACHE_HOME: path.join(scratchDir, "cache"),
        npm_config_cache: path.join(scratchDir, "npm-cache"),
        YARN_CACHE_FOLDER: path.join(scratchDir, "yarn-cache"),
      },
      timeout: CHECK_TIMEOUT_MS,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      name,
      command: displayCommand,
      status: "passed",
      exit_code: 0,
      output: output.slice(-MAX_OUTPUT_CHARS),
      duration_ms: Date.now() - startedAt,
    };
  } catch (error: any) {
    const output = `${error.stdout?.toString() || ""}${error.stderr?.toString() || ""}`;
    if (/sandbox_apply: Operation not permitted|sandbox initialization failed/i.test(output)) {
      return skippedCheck(
        name,
        displayCommand,
        "Package script skipped because the host would not allow the local execution sandbox to start.",
        startedAt,
      );
    }
    return {
      name,
      command: displayCommand,
      status: "failed",
      exit_code: typeof error.status === "number" ? error.status : null,
      output: output.slice(-MAX_OUTPUT_CHARS),
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

function packageManager(worktreeDir: string): "yarn" | "npm" | "pnpm" | "bun" | null {
  if (fs.existsSync(path.join(worktreeDir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(worktreeDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(worktreeDir, "bun.lockb")) || fs.existsSync(path.join(worktreeDir, "bun.lock"))) return "bun";
  if (fs.existsSync(path.join(worktreeDir, "package-lock.json")) || fs.existsSync(path.join(worktreeDir, "package.json"))) return "npm";
  return null;
}

export function runReviewChecks(input: {
  worktreeDir: string;
  baseSha: string | null;
  headSha: string;
}): ReviewCheckResult[] {
  const checks: ReviewCheckResult[] = [];

  if (input.baseSha) {
    checks.push(runCommand("diff_check", "git", ["diff", "--check", input.baseSha, input.headSha], input.worktreeDir));
  } else {
    checks.push({
      name: "diff_check",
      command: "git diff --check <base> <head>",
      status: "skipped",
      exit_code: null,
      output: "Base SHA was not available.",
      duration_ms: 0,
    });
  }

  const packageJsonPath = path.join(input.worktreeDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return checks;

  let scripts: Record<string, unknown> = {};
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    scripts = packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  } catch {
    checks.push({
      name: "package_manifest",
      command: "read package.json",
      status: "failed",
      exit_code: null,
      output: "package.json could not be parsed.",
      duration_ms: 0,
    });
    return checks;
  }

  const manager = packageManager(input.worktreeDir);
  if (!manager) return checks;

  for (const script of ["typecheck", "lint", "test"]) {
    if (typeof scripts[script] !== "string") continue;
    checks.push(runSandboxedPackageScript(
      `${script}_script`,
      manager,
      manager === "npm" ? ["run", script] : [script],
      input.worktreeDir,
    ));
  }

  return checks;
}
