import { execFile } from "node:child_process";
import os from "node:os";

/** Run Git without blocking other HTTP requests while a remote responds. */
export function runGitAsync(
  directory: string,
  args: string[],
  timeout = 30000,
): Promise<{ stdout: string; returncode: number }> {
  return new Promise((resolve) => {
    execFile("git", args, {
      cwd: directory,
      timeout,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: os.homedir(),
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes",
      },
    }, (error, stdout, stderr) => {
      resolve({ stdout: stdout || stderr, returncode: error ? 1 : 0 });
    });
  });
}
