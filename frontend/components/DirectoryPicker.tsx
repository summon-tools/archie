"use client";

import { useState, useEffect, useCallback } from "react";
import { FolderOpen, FolderSimple, CaretLeft, GitBranch, SpinnerGap, X } from "@phosphor-icons/react";

interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  isGitRepo: boolean;
  dirs: DirEntry[];
}

export default function DirectoryPicker({
  onSelect,
  onClose,
  initialPath,
  requireGitRepo = true,
}: {
  onSelect: (path: string) => void;
  onClose: () => void;
  initialPath?: string;
  requireGitRepo?: boolean;
}) {
  const [browsePath, setBrowsePath] = useState(initialPath || "");
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const browse = useCallback(async (dirPath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
      const res = await fetch(`/api/fs/browse${params}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to browse");
      }
      const data: BrowseResult = await res.json();
      setResult(data);
      setBrowsePath(data.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to browse directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    browse(initialPath || undefined);
  }, [browse, initialPath]);

  function handleSelect(dirPath: string) {
    onSelect(dirPath);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-heavy">
      <div className="bg-th-elevated border border-th rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-th">
          <div className="flex items-center gap-2">
            <FolderOpen size={20} className="text-th-secondary" />
            <h3 className="text-sm font-semibold text-th-primary">Choose Directory</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-th-muted hover:text-th-primary hover:bg-th-muted rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Current path */}
        <div className="px-5 py-3 border-b border-th bg-th-subtle">
          <p className="text-xs font-mono text-th-secondary truncate" title={browsePath}>
            {browsePath}
          </p>
          {result?.isGitRepo && (
            <div className="flex items-center gap-1 mt-1">
              <GitBranch size={12} className="text-st-green" />
              <span className="text-xs text-st-green font-medium">Git repository</span>
            </div>
          )}
        </div>

        {/* Directory listing */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <SpinnerGap size={20} className="animate-spin text-th-muted" />
            </div>
          )}

          {error && (
            <div className="px-5 py-4 text-sm text-st-red">{error}</div>
          )}

          {!loading && !error && result && (
            <div className="py-1">
              {/* Go up */}
              {result.parent && (
                <button
                  onClick={() => browse(result.parent!)}
                  className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-th-muted transition-colors text-left"
                >
                  <CaretLeft size={16} className="text-th-muted flex-shrink-0" />
                  <span className="text-sm text-th-secondary">..</span>
                </button>
              )}

              {result.dirs.length === 0 && (
                <p className="px-5 py-6 text-sm text-th-muted text-center">No subdirectories</p>
              )}

              {result.dirs.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => browse(dir.path)}
                  className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-th-muted transition-colors text-left group"
                >
                  <FolderSimple
                    size={16}
                    weight={dir.isGitRepo ? "fill" : "regular"}
                    className={dir.isGitRepo ? "text-st-green flex-shrink-0" : "text-th-muted flex-shrink-0"}
                  />
                  <span className="text-sm text-th-primary truncate flex-1">{dir.name}</span>
                  {dir.isGitRepo && (
                    <GitBranch size={12} className="text-st-green flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-th">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-th-secondary hover:text-th-primary transition"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSelect(browsePath)}
            disabled={requireGitRepo && !result?.isGitRepo}
            className="px-5 py-2 text-sm font-medium bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {requireGitRepo
              ? result?.isGitRepo ? "Select" : "Select (not a git repo)"
              : "Select"}
          </button>
        </div>
      </div>
    </div>
  );
}
