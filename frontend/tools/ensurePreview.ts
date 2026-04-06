import { startPreview, getWorkItem } from "@/lib/api";
import type { ToolContext } from "./types";

/**
 * Ensures the preview is running before a tool executes.
 * If the preview is already running, this is a no-op.
 * If not, starts it and waits briefly for it to come up.
 */
export async function ensurePreviewRunning(
  ctx: ToolContext,
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  // Check if preview is already running
  if (ctx.workItem.preview_port && ctx.workItem.preview_pid) {
    return true;
  }

  // Check if worktree exists (needed for preview)
  if (!ctx.workItem.worktree_dir && !ctx.app.directory) {
    onProgress?.("No workspace available — cannot start preview");
    return false;
  }

  onProgress?.("Starting preview...");

  try {
    const result = await startPreview(ctx.appId, ctx.itemId);
    if (!result.success) {
      onProgress?.(`Failed to start preview: ${result.message}`);
      return false;
    }

    // Wait a moment for the server to boot
    onProgress?.("Waiting for preview to start...");
    await new Promise((r) => setTimeout(r, 3000));

    // Refresh work item to get updated preview port/pid
    try {
      const updated = await getWorkItem(ctx.appId, ctx.itemId);
      // Update the context's workItem reference in-place for the current execution
      Object.assign(ctx.workItem, updated);
    } catch {
      // Best effort — the preview may still work even if refresh fails
    }

    onProgress?.("Preview started");
    return true;
  } catch (err) {
    onProgress?.(`Failed to start preview: ${err instanceof Error ? err.message : "unknown error"}`);
    return false;
  }
}
