"use client";

import { useEffect, useState, useMemo } from "react";
import { ArrowsClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";
import { getWorktreeDiff } from "@/lib/api";

interface DiffPanelProps {
  appId: number;
  itemId: number;
  highlightFile?: string | null;
}

interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  lines: string[];
}

function parseDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  const chunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const headerMatch = lines[0]?.match(/a\/(.+?) b\//);
    const filePath = headerMatch ? headerMatch[1] : "unknown";

    let additions = 0;
    let deletions = 0;
    const diffLines: string[] = [];

    for (const line of lines.slice(1)) {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("old mode") || line.startsWith("new mode")) {
        continue;
      }
      diffLines.push(line);
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({ path: filePath, additions, deletions, lines: diffLines });
  }

  return files;
}

function DiffFile({ file, highlighted, forceExpanded }: { file: FileDiff; highlighted?: boolean; forceExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  return (
    <div id={`diff-file-${file.path.replace(/\//g, "-")}`} className={`border rounded-lg overflow-hidden ${highlighted ? "border-brand-400/50 ring-1 ring-brand-400/30" : "border-th"}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-th-muted hover:bg-overlay-medium transition-colors text-left"
      >
        {expanded ? <CaretDown size={12} weight="bold" className="text-th-dimmed flex-shrink-0" /> : <CaretRight size={12} weight="bold" className="text-th-dimmed flex-shrink-0" />}
        <span className="text-xs font-mono text-th-primary truncate flex-1">{file.path}</span>
        <span className="text-meta font-mono text-st-green flex-shrink-0">+{file.additions}</span>
        <span className="text-meta font-mono text-st-red flex-shrink-0">-{file.deletions}</span>
      </button>
      {expanded && (
        <pre className="overflow-x-auto text-xs leading-relaxed font-mono">
          {file.lines.map((line, i) => {
            let className = "px-3 ";
            if (line.startsWith("+")) {
              className += "bg-st-green text-st-green";
            } else if (line.startsWith("-")) {
              className += "bg-st-red text-st-red";
            } else if (line.startsWith("@@")) {
              className += "bg-st-blue text-st-blue";
            } else {
              className += "text-th-muted";
            }
            return (
              <div key={i} className={className}>
                {line}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}

export default function DiffPanel({ appId, itemId, highlightFile }: DiffPanelProps) {
  const [diff, setDiff] = useState("");
  const [stat, setStat] = useState("");
  const [filesChanged, setFilesChanged] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = async () => {
    setLoading(true);
    try {
      const data = await getWorktreeDiff(appId, itemId);
      setDiff(data.diff);
      setStat(data.stat);
      setFilesChanged(data.files_changed);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiff();
  }, [appId, itemId]);

  const files = useMemo(() => parseDiff(diff), [diff]);

  useEffect(() => {
    if (highlightFile) {
      const id = `diff-file-${highlightFile.replace(/\//g, "-")}`;
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [highlightFile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-th-muted">
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-th-muted">
        Failed to load diff
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-th-muted">
        No changes yet
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-th flex-shrink-0">
        <span className="text-xs text-th-muted">
          {filesChanged} file{filesChanged !== 1 ? "s" : ""} changed
        </span>
        <button
          onClick={fetchDiff}
          className="p-2 text-th-muted hover:text-th-primary rounded transition-colors"
          title="Refresh diff"
        >
          <ArrowsClockwise size={14} weight="bold" />
        </button>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {files.map((file) => (
          <DiffFile
            key={file.path}
            file={file}
            highlighted={highlightFile === file.path}
            forceExpanded={highlightFile === file.path}
          />
        ))}
      </div>
    </div>
  );
}
