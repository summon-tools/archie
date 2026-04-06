/**
 * Compact inline component showing a tool activity (file read, bash command, etc.)
 * displayed below streaming messages during Claude's work.
 */

import { FileText, Terminal, MagnifyingGlass, Lightning, Globe, Gear, SpinnerGap, ArrowsClockwise, Pulse } from "@phosphor-icons/react";

interface ToolActivityProps {
  kind?: "tool_start" | "tool_end" | "command" | "file_change" | "progress" | "retry" | "status";
  tool: string;
  summary: string;
  active: boolean;
}

/** Icon for the tool type */
function ToolIcon({ tool, kind }: { tool: string; kind?: ToolActivityProps["kind"] }) {
  if (kind === "retry") {
    return <ArrowsClockwise size={12} className="flex-shrink-0" />;
  }

  if (kind === "progress" || kind === "status") {
    return <Pulse size={12} className="flex-shrink-0" />;
  }

  if (kind === "command") {
    return <Terminal size={12} className="flex-shrink-0" />;
  }

  if (kind === "file_change") {
    return <FileText size={12} className="flex-shrink-0" />;
  }

  // File operations
  if (tool === "Read" || tool === "Write" || tool === "Edit") {
    return <FileText size={12} className="flex-shrink-0" />;
  }

  // Terminal / Bash
  if (tool === "Bash") {
    return <Terminal size={12} className="flex-shrink-0" />;
  }

  // Search: Grep, Glob, WebSearch
  if (tool === "Grep" || tool === "Glob" || tool === "WebSearch") {
    return <MagnifyingGlass size={12} className="flex-shrink-0" />;
  }

  // Agent / Task
  if (tool === "Task") {
    return <Lightning size={12} className="flex-shrink-0" />;
  }

  // Web fetch
  if (tool === "WebFetch") {
    return <Globe size={12} className="flex-shrink-0" />;
  }

  // Default: gear icon
  return <Gear size={12} className="flex-shrink-0" />;
}

/** Small spinner for active tools */
function MiniSpinner() {
  return <SpinnerGap size={12} className="animate-spin flex-shrink-0" />;
}

export default function ToolActivity({ kind, tool, summary, active }: ToolActivityProps) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-opacity ${
        active
          ? "bg-th-subtle text-th-secondary"
          : "text-th-dimmed"
      }`}
    >
      <span className={active ? "text-th-muted" : "text-th-dimmed"}>
        <ToolIcon tool={tool} kind={kind} />
      </span>
      <span className="text-meta truncate">{summary}</span>
      {active && <MiniSpinner />}
    </div>
  );
}
