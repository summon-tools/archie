"use client";

import React, { useEffect, useRef, useState } from "react";
import { SpinnerGap, Circle } from "@phosphor-icons/react";
import { useConsole } from "@/hooks/useConsole";

interface ConsolePanelProps {
  appId: number;
  workItemId?: number;
  onErrorCount?: (count: number) => void;
}

export default function ConsolePanel({ appId, workItemId, onErrorCount }: ConsolePanelProps) {
  const [processId, setProcessId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const outputRef = useRef<HTMLPreElement>(null);
  const autoScrollRef = useRef(true);

  // Fetch the active managed process for this context.
  // Keep polling so we pick up new process IDs after restarts.
  useEffect(() => {
    let cancelled = false;

    const fetchProcess = async () => {
      try {
        const params = new URLSearchParams({ app_id: String(appId) });
        if (workItemId) params.set("work_item_id", String(workItemId));
        const res = await fetch(`/api/processes?${params}`);
        const data = await res.json();
        if (!cancelled) {
          if (data.process) {
            // Update process ID if it changed (e.g. after restart)
            setProcessId((prev) => prev === data.process.id ? prev : data.process.id);
          } else {
            setProcessId(null);
          }
        }
      } catch {
        // No process found
      }
      if (!cancelled) setLoading(false);
    };

    fetchProcess();

    // Safety-net polling at 30s (process discovery is rare)
    const interval = setInterval(() => {
      if (!cancelled) fetchProcess();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [appId, workItemId]);

  const { content, isConnected, processStatus } = useConsole({ processId });

  // When the WebSocket reports process stopped/exited, re-fetch after a short
  // delay to pick up a potential replacement process quickly without waiting
  // for the 30s polling cycle.
  useEffect(() => {
    if (processStatus !== "stopped" && processStatus !== "exited") return;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ app_id: String(appId) });
        if (workItemId) params.set("work_item_id", String(workItemId));
        const res = await fetch(`/api/processes?${params}`);
        const data = await res.json();
        if (data.process) {
          setProcessId((prev) => prev === data.process.id ? prev : data.process.id);
        } else {
          setProcessId(null);
        }
      } catch {}
    }, 2000);
    return () => clearTimeout(timer);
  }, [processStatus, appId, workItemId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScrollRef.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [content]);

  // Report error count to parent
  useEffect(() => {
    if (!onErrorCount) return;
    if (!content) { onErrorCount(0); return; }
    const count = content.split("\n").filter((line) =>
      /error|ERR!|ENOENT|EACCES|TypeError|ReferenceError|SyntaxError|FATAL/i.test(line)
    ).length;
    onErrorCount(count);
  }, [content, onErrorCount]);

  const handleScroll = () => {
    if (!outputRef.current) return;
    const el = outputRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScrollRef.current = atBottom;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <SpinnerGap size={20} className="animate-spin text-th-muted" />
      </div>
    );
  }

  if (!processId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-th-muted">
        <div className="text-center">
          <p>No active process</p>
          <p className="text-xs text-th-dimmed mt-1">Start a preview to see live output</p>
        </div>
      </div>
    );
  }

  const statusLabel =
    processStatus === "running" ? "Running"
    : processStatus === "stopped" ? "Stopped"
    : processStatus === "unknown" ? "Connecting…"
    : "Crashed";

  const statusColor =
    processStatus === "running"
      ? "text-green-500"
      : processStatus === "stopped" || processStatus === "unknown"
      ? "text-th-muted"
      : "text-red-400";

  return (
    <div className="flex flex-col h-full bg-[#1a1b26]">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1 bg-[#16161e] border-b border-[#292e42] flex-shrink-0">
        <Circle size={8} weight="fill" className={statusColor} />
        <span className="text-xs text-[#565f89]">
          {statusLabel}
        </span>
        {isConnected && (
          <span className="ml-auto text-meta text-[#565f89]">
            <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full mr-1" />
            live
          </span>
        )}
      </div>

      {/* Output */}
      <pre
        ref={outputRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-3 text-xs font-mono text-[#c0caf5] leading-relaxed whitespace-pre-wrap break-words"
      >
        {content || <span className="text-[#565f89]">Waiting for output...</span>}
      </pre>
    </div>
  );
}
