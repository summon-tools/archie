/**
 * Helpers for rendering provider-neutral activity summaries in the UI.
 */

export interface StreamActivityEvent {
  kind: "tool_start" | "tool_end" | "command" | "file_change" | "progress" | "retry" | "status";
  key?: string;
  label?: string;
  input?: Record<string, unknown> | null;
  command?: string;
  status?: "started" | "completed";
  output?: string;
  files?: { path: string; kind: string }[];
  message?: string;
}

export interface StreamActivityChip {
  id: string;
  kind: StreamActivityEvent["kind"];
  tool: string;
  summary: string;
  active: boolean;
}

/** Shorten a file path to the last 2-3 segments for readability. */
export function shortenPath(filePath: string): string {
  if (!filePath) return "";
  const parts = filePath.replace(/^\/+/, "").split("/");
  if (parts.length <= 3) return parts.join("/");
  return ".../" + parts.slice(-3).join("/");
}

/** Truncate a string to maxLen chars, appending ellipsis if needed. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}

/**
 * Given a Claude-style tool name and parsed input object, return a readable summary.
 */
export function getToolSummary(
  tool: string,
  input: Record<string, unknown> | null
): string {
  if (!input) return tool;

  switch (tool) {
    case "Read": {
      const fp = input.file_path as string | undefined;
      return fp ? `Reading ${shortenPath(fp)}` : "Reading file";
    }
    case "Edit": {
      const fp = input.file_path as string | undefined;
      return fp ? `Editing ${shortenPath(fp)}` : "Editing file";
    }
    case "Write": {
      const fp = input.file_path as string | undefined;
      return fp ? `Writing ${shortenPath(fp)}` : "Writing file";
    }
    case "Bash": {
      const cmd = input.command as string | undefined;
      if (cmd) return `$ ${truncate(cmd.trim(), 80)}`;
      const desc = input.description as string | undefined;
      if (desc) return truncate(desc, 80);
      return "Running command";
    }
    case "Glob": {
      const pattern = input.pattern as string | undefined;
      return pattern ? `Finding files: ${truncate(pattern, 60)}` : "Finding files";
    }
    case "Grep": {
      const pattern = input.pattern as string | undefined;
      return pattern ? `Searching: "${truncate(pattern, 60)}"` : "Searching code";
    }
    case "Task": {
      const desc = input.description as string | undefined;
      return desc ? `Agent: ${truncate(desc, 60)}` : "Running agent";
    }
    case "WebSearch": {
      const query = input.query as string | undefined;
      return query ? `Searching web: "${truncate(query, 60)}"` : "Searching web";
    }
    case "WebFetch": {
      const url = input.url as string | undefined;
      return url ? `Fetching: ${truncate(url, 60)}` : "Fetching URL";
    }
    default:
      return tool;
  }
}

function summarizeFileChange(files: { path: string; kind: string }[] | undefined): string {
  if (!files || files.length === 0) return "Updated files";
  if (files.length === 1) {
    return `${files[0].kind === "create" ? "Created" : files[0].kind === "delete" ? "Deleted" : "Updated"} ${shortenPath(files[0].path)}`;
  }
  return `Updated ${files.length} files`;
}

export function createActivityChip(activity: StreamActivityEvent): StreamActivityChip {
  switch (activity.kind) {
    case "tool_start":
      return {
        id: activity.key || activity.label || "tool",
        kind: activity.kind,
        tool: activity.label || "Tool",
        summary: activity.label || "Running tool",
        active: true,
      };
    case "tool_end":
      return {
        id: activity.key || activity.label || "tool",
        kind: activity.kind,
        tool: activity.label || "Tool",
        summary: getToolSummary(activity.label || "Tool", activity.input || null),
        active: false,
      };
    case "command":
      return {
        id: activity.key || activity.command || "command",
        kind: activity.kind,
        tool: "Command",
        summary: activity.status === "started"
          ? `$ ${truncate((activity.command || "").trim(), 80)}`
          : `Finished ${truncate((activity.command || "").trim(), 60)}`,
        active: activity.status === "started",
      };
    case "file_change":
      return {
        id: activity.key || activity.files?.map((f) => f.path).join(",") || "file_change",
        kind: activity.kind,
        tool: "Files",
        summary: summarizeFileChange(activity.files),
        active: false,
      };
    case "progress":
      return {
        id: activity.key || activity.message || "progress",
        kind: activity.kind,
        tool: "Progress",
        summary: truncate(activity.message || "Working...", 100),
        active: true,
      };
    case "retry":
      return {
        id: activity.key || activity.message || "retry",
        kind: activity.kind,
        tool: "Retry",
        summary: truncate(activity.message || "Retrying...", 100),
        active: true,
      };
    case "status":
      return {
        id: activity.key || activity.message || "status",
        kind: activity.kind,
        tool: "Status",
        summary: truncate(activity.message || "Working...", 100),
        active: true,
      };
  }
}

export function shouldReloadPreviewForActivity(activity: StreamActivityEvent): boolean {
  if (activity.kind === "tool_end" && ["Write", "Edit", "Bash"].includes(activity.label || "")) {
    return true;
  }
  if (activity.kind === "file_change") {
    return true;
  }
  if (activity.kind === "command" && activity.status === "completed") {
    const cmd = activity.command || "";
    return /npm|pnpm|yarn|bun|rails|python|manage\.py|vite|next/i.test(cmd);
  }
  return false;
}

export function applyActivityToFeed(
  prev: StreamActivityChip[],
  activity: StreamActivityEvent
): StreamActivityChip[] {
  const nextChip = createActivityChip(activity);

  if (activity.kind === "tool_start" || (activity.kind === "command" && activity.status === "started")) {
    return [...prev.slice(-4), nextChip];
  }

  if (activity.kind === "tool_end" || (activity.kind === "command" && activity.status === "completed")) {
    const updated = [...prev];
    const lastActive = updated.findLastIndex((entry) => entry.id === nextChip.id && entry.active);
    if (lastActive >= 0) {
      updated[lastActive] = nextChip;
      return updated.slice(-5);
    }
    return [...updated.slice(-4), nextChip];
  }

  if (activity.kind === "progress" || activity.kind === "retry" || activity.kind === "status") {
    const updated = [...prev];
    const lastEntry = updated[updated.length - 1];
    if (lastEntry && lastEntry.kind === activity.kind && lastEntry.active) {
      updated[updated.length - 1] = nextChip;
      return updated.slice(-5);
    }
    return [...updated.slice(-4), nextChip];
  }

  return [...prev.slice(-4), nextChip];
}
