"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { getWorktreeLogs } from "@/lib/api";

interface LogsPanelProps {
  appId: number;
  itemId: number;
}

export default function LogsPanel({ appId, itemId }: LogsPanelProps) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const autoScroll = useRef(true);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await getWorktreeLogs(appId, itemId, 200);
      setContent(data.content);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [appId, itemId]);

  // Initial fetch on mount (no polling)
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchLogs();
    setRefreshing(false);
  };

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    if (autoScroll.current && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [content]);

  const handleScroll = () => {
    if (!preRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = preRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-end px-3 py-1.5 border-b border-th-border flex-shrink-0">
          <button
            onClick={handleRefresh}
            className="p-2 rounded hover:bg-th-muted text-th-muted hover:text-th-secondary transition-colors"
            title="Refresh logs"
          >
            <ArrowsClockwise size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="flex items-center justify-center flex-1 text-sm text-th-muted">
          Failed to load logs
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-end px-3 py-1.5 border-b border-th-border flex-shrink-0">
          <button
            onClick={handleRefresh}
            className="p-2 rounded hover:bg-th-muted text-th-muted hover:text-th-secondary transition-colors"
            title="Refresh logs"
          >
            <ArrowsClockwise size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="flex items-center justify-center flex-1 text-sm text-th-muted">
          No log output yet
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end px-3 py-1.5 border-b border-th-border flex-shrink-0">
        <button
          onClick={handleRefresh}
          className="p-2 rounded hover:bg-th-muted text-th-muted hover:text-th-secondary transition-colors"
          title="Refresh logs"
        >
          <ArrowsClockwise size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>
      <pre
        ref={preRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-4 text-xs leading-relaxed font-mono text-th-secondary bg-th-code whitespace-pre-wrap break-words"
      >
        {content}
      </pre>
    </div>
  );
}
