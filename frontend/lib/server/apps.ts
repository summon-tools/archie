import { readManifest } from "./manifest";
import { runStart, runStop } from "./runner";
import { checkPortSync } from "./platform";
import { registerProcess, updateProcessStatus, getActiveProcess } from "./dal/processes";

export { checkPortSync };

export function startApp(
  directory: string,
  port?: number,
  appId?: number
): { success: boolean; message: string } {
  const manifest = readManifest(directory);
  if (!manifest) {
    return { success: false, message: `No .archie/app.yaml manifest found in ${directory}` };
  }
  if (!port) {
    return { success: false, message: "Port is required" };
  }
  const result = runStart(directory, manifest, port);

  // Register as managed process for live console
  if (result.success && result.pid && appId) {
    try {
      registerProcess({
        app_id: appId,
        kind: "app",
        pid: result.pid,
        port,
        log_path: result.logFile,
      });
    } catch {
      // Non-critical — don't fail the start
    }
  }

  return { success: result.success, message: result.message };
}

export function stopApp(
  directory: string,
  port?: number,
  appId?: number
): { success: boolean; message: string } {
  // Mark managed process as stopped
  if (appId) {
    try {
      const proc = getActiveProcess(appId, "app");
      if (proc) updateProcessStatus(proc.id, "stopped");
    } catch {
      // Non-critical
    }
  }

  return runStop(directory, port);
}

export function restartApp(
  directory: string,
  port?: number,
  appId?: number
): { success: boolean; message: string } {
  const stopResult = stopApp(directory, port, appId);
  const startResult = startApp(directory, port, appId);
  return {
    success: startResult.success,
    message: `Stop: ${stopResult.message}\nStart: ${startResult.message}`,
  };
}
