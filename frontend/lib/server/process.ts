import { execSync } from "child_process";
import os from "os";

export function killProcessOnPort(
  port: number,
  force: boolean = false
): boolean {
  try {
    let pids: string[];

    if (os.platform() === "darwin") {
      const result = execSync(`lsof -ti :${port}`, { timeout: 10000 })
        .toString()
        .trim();
      pids = result.split("\n").filter(Boolean);
    } else {
      const result = execSync(`fuser ${port}/tcp`, { timeout: 10000 })
        .toString()
        .trim();
      pids = result.split(/\s+/).filter(Boolean);
    }

    const sig = force ? "SIGKILL" : "SIGTERM";
    let killed = false;
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), sig);
        killed = true;
      } catch {
        // Process already dead
      }
    }
    return killed;
  } catch {
    return false;
  }
}
