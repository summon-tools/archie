"use client";

/**
 * Full tool registry — includes React components and hooks.
 * Only importable from client-side code.
 */
import type { Tool } from "./types";
import { walkthrough } from "./walkthrough";
import { seed } from "./seed";
import { recordVideo } from "./record-video";
import { codeWalkthrough } from "./code-walkthrough";

export const tools: Tool[] = [walkthrough, seed, recordVideo, codeWalkthrough];

export function getTool(id: string): Tool | undefined {
  return tools.find((s) => s.id === id);
}

export function getToolByMessageType(type: string): Tool | undefined {
  return tools.find((s) => s.messageType === type);
}
