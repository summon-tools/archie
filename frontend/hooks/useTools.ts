"use client";

import { walkthrough } from "@/tools/walkthrough";
import { seed } from "@/tools/seed";
import { recordVideo } from "@/tools/record-video";
import { codeWalkthrough } from "@/tools/code-walkthrough";
import type { ToolContext, ToolState } from "@/tools/types";

/**
 * Composite hook that instantiates all tool hooks.
 *
 * Each tool's useTool is called unconditionally in a fixed order,
 * satisfying React's rules of hooks (the tool list is static).
 *
 * To add a new tool: import it and add a line here.
 */
export function useTools(ctx: ToolContext): Map<string, ToolState> {
  const walkthroughState = walkthrough.useTool(ctx);
  const seedState = seed.useTool(ctx);
  const recordVideoState = recordVideo.useTool(ctx);
  const codeWalkthroughState = codeWalkthrough.useTool(ctx);

  return new Map([
    [walkthrough.id, walkthroughState],
    [seed.id, seedState],
    [recordVideo.id, recordVideoState],
    [codeWalkthrough.id, codeWalkthroughState],
  ]);
}
