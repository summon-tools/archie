import type { App, Task } from "@/lib/types";

/** Static metadata — used for dropdown, intent classification, message rendering */
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  intentKeywords: string;
  messageType: string;
}

/** Runtime context passed to every tool's execute function */
export interface ToolContext {
  appId: number;
  itemId: number;
  app: App;
  workItem: Task;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  proxyBase: string;
  saveMessage: (content: string, role: "user" | "assistant", type?: string) => Promise<void>;
  reloadMessages: () => Promise<void>;
  setDiffHighlight?: (file: string | null) => void;
  setForceTab?: (tab: "preview" | "diff" | null) => void;
}

/** What a tool's hook returns — standardized across all tools */
export interface ToolState {
  execute: (input: string) => Promise<void>;
  cancel: () => void;
  busy: boolean;
  progress: string | null;
}

/** Full tool = definition + hook factory + components */
export interface Tool extends ToolDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  useTool: (ctx: ToolContext) => ToolState;
  ProgressCard: React.ComponentType<{ progress: string | null }>;
  ResultCard: React.ComponentType<{ content: string; appId: number; itemId: number }>;
}
