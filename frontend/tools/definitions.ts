/**
 * Plain tool definitions — no React, safe to import from server-side routes.
 */
import type { ToolDefinition } from "./types";
import { walkthroughDefinition } from "./walkthrough/definition";
import { seedDefinition } from "./seed/definition";
import { recordVideoDefinition } from "./record-video/definition";
import { codeWalkthroughDefinition } from "./code-walkthrough/definition";

export const toolDefinitions: ToolDefinition[] = [
  walkthroughDefinition,
  seedDefinition,
  recordVideoDefinition,
  codeWalkthroughDefinition,
];
