"use client";

import React, { useState, useCallback, useEffect, useRef, lazy, Suspense, useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import {
  ArrowsClockwise,
  ArrowSquareOut,
  Stop,
  Eye,
  GitDiff,
  CaretDown,
  CaretUp,
  MonitorPlay,
  ListBullets,
  GearSix,
} from "@phosphor-icons/react";
import { Task } from "@/lib/types";

const LogsPanel = lazy(() => import("./LogsPanel"));
const DiffPanel = lazy(() => import("./DiffPanel"));
const ConsolePanel = lazy(() => import("./ConsolePanel"));

interface PreviewPanelProps {
  workItem: Task;
  startingPreview: boolean;
  stoppingPreview: boolean;
  restartingPreview: boolean;
  previewError: string | null;
  onStartPreview: () => void;
  onStopPreview: () => void;
  onRestartPreview: () => void;
  appId: number;
  appDirectory?: string;
  narrationText?: string | null;
  forceTab?: "preview" | "diff" | null;
  diffHighlightFile?: string | null;
}

function PreviewActionsDropdown({
  onRefresh,
  openUrl,
  onStop,
  stoppingPreview,
}: {
  onRefresh: () => void;
  openUrl: string;
  onStop: () => void;
  stoppingPreview: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-meta px-2.5 py-1 bg-th-muted text-th-primary hover:bg-th-elevated rounded-lg font-medium flex items-center gap-1.5 transition-colors"
      >
        <GearSix size={12} weight="bold" />
        Actions
        <CaretDown size={10} className="text-th-muted" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50">
          <button
            onClick={() => { onRefresh(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-th-muted transition-colors text-left"
          >
            <ArrowsClockwise size={15} weight="bold" className="text-th-muted flex-shrink-0" />
            <span className="text-th-primary text-xs">Refresh</span>
          </button>
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-th-muted transition-colors text-left"
          >
            <ArrowSquareOut size={15} weight="bold" className="text-th-muted flex-shrink-0" />
            <span className="text-th-primary text-xs">Open in new tab</span>
          </a>
          <button
            onClick={() => { onStop(); setOpen(false); }}
            disabled={stoppingPreview}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-th-muted transition-colors text-left disabled:opacity-50"
          >
            <Stop size={15} weight="fill" className="text-st-red flex-shrink-0" />
            <span className="text-th-primary text-xs">Stop preview</span>
          </button>
        </div>
      )}
    </div>
  );
}

const PreviewPanel = React.forwardRef<HTMLIFrameElement, PreviewPanelProps>(
  function PreviewPanel(
    {
      workItem,
      startingPreview,
      stoppingPreview,
      restartingPreview,
      previewError,
      onStartPreview,
      onStopPreview,
      onRestartPreview,
      appId,
      appDirectory,
      narrationText,
      forceTab,
      diffHighlightFile,
    },
    ref
  ) {
    type PanelTab = "preview" | "diff";
    const [activeTab, setActiveTab] = useState<PanelTab>("preview");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerHeight, setDrawerHeight] = useState(200);
    type DrawerTab = "console" | "logs";
    const [drawerTab, setDrawerTab] = useState<DrawerTab>("console");
    const [consoleErrorCount, setConsoleErrorCount] = useState(0);
    const [path, setPath] = useState("/");
    const [urlInput, setUrlInput] = useState("/");

    // External tab override (used by code walkthrough tool)
    useEffect(() => {
      if (forceTab) setActiveTab(forceTab);
    }, [forceTab]);

    // Auto-expand console drawer when errors appear
    useEffect(() => {
      if (consoleErrorCount > 0 && !drawerOpen) {
        setDrawerOpen(true);
        setDrawerTab("console");
      }
    }, [consoleErrorCount]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch diff stats for the Diff tab badge
    const canDiff = !!workItem.worktree_dir || !!workItem.branch_name;
    const { data: diffData } = useSWR<{ stat: string; files_changed: number }>(
      canDiff ? `/api/apps/${appId}/work-items/${workItem.id}/env/diff` : null,
      fetcher,
      { refreshInterval: 15000 },
    );

    // Parse +/- from git diff --stat summary line (e.g. "3 files changed, 42 insertions(+), 5 deletions(-)")
    const diffStats = useMemo(() => {
      if (!diffData?.stat) return null;
      const lines = diffData.stat.trim().split("\n");
      const summary = lines[lines.length - 1] || "";
      const insMatch = summary.match(/(\d+) insertion/);
      const delMatch = summary.match(/(\d+) deletion/);
      const ins = insMatch ? Number(insMatch[1]) : 0;
      const del = delMatch ? Number(delMatch[1]) : 0;
      if (ins === 0 && del === 0) return null;
      return { insertions: ins, deletions: del };
    }, [diffData?.stat]);

    const isRunning = !!(workItem.preview_pid && workItem.preview_port);
    const hasWorktree = !!workItem.worktree_dir;
    const hasBranch = !!workItem.branch_name;
    // Preview can run in either a worktree or the app directory (e.g. setup tasks)
    const canPreview = hasWorktree || !!appDirectory;
    // canDiff defined earlier (used for diff stats SWR)
    const proxyBase = `/api/p/${workItem.preview_port}`;
    const previewUrl = isRunning ? `${proxyBase}${path}` : null;
    const directUrl = isRunning
      ? `http://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:${workItem.preview_port}${path}`
      : null;

    // Navigate to a new path
    const navigateTo = useCallback((newPath: string) => {
      const normalized = newPath.startsWith("/") ? newPath : `/${newPath}`;
      setPath(normalized);
      setUrlInput(normalized);
    }, []);

    const handleUrlSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        navigateTo(urlInput);
        (e.target as HTMLInputElement).blur();
      }
    };

    const handleRefresh = () => {
      const iframe = (ref as React.RefObject<HTMLIFrameElement | null>)?.current;
      if (iframe) {
        iframe.src = previewUrl || "";
      }
    };

    // Track navigation inside the iframe
    useEffect(() => {
      const iframe = (ref as React.RefObject<HTMLIFrameElement | null>)?.current;
      if (!iframe || !isRunning) return;

      let lastHref = "";
      const syncUrl = () => {
        try {
          const loc = iframe.contentWindow?.location;
          if (!loc || loc.href === lastHref) return;
          lastHref = loc.href;
          const iframePath = loc.pathname || "";
          if (iframePath.startsWith(proxyBase)) {
            const appPath = iframePath.slice(proxyBase.length) || "/";
            const search = loc.search || "";
            const fullPath = appPath + search;
            setPath(fullPath);
            setUrlInput(fullPath);
          }
        } catch {}
      };

      iframe.addEventListener("load", syncUrl);
      const interval = setInterval(syncUrl, 500);
      return () => {
        iframe.removeEventListener("load", syncUrl);
        clearInterval(interval);
      };
    }, [isRunning, proxyBase, ref]);

    // Reset path when preview stops
    useEffect(() => {
      if (!isRunning) {
        setPath("/");
        setUrlInput("/");
      }
    }, [isRunning]);

    return (
      <div className="flex flex-col h-full bg-th-surface">
        {/* Header bar: tabs + URL bar + controls */}
        <div className="h-10 border-b border-th flex items-center gap-1.5 px-2 flex-shrink-0">
          {/* Preview / Diff tabs */}
          {canPreview && (
            <div className="flex items-center bg-th-muted rounded-lg p-0.5 flex-shrink-0">
              <button
                onClick={() => setActiveTab("preview")}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  activeTab === "preview"
                    ? "bg-th-elevated text-th-primary shadow-sm"
                    : "text-th-muted hover:text-th-secondary"
                }`}
              >
                <Eye size={13} weight={activeTab === "preview" ? "bold" : "regular"} />
                Preview
              </button>
              {canDiff && (
                <button
                  onClick={() => setActiveTab("diff")}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    activeTab === "diff"
                      ? "bg-th-elevated text-th-primary shadow-sm"
                      : "text-th-muted hover:text-th-secondary"
                  }`}
                >
                  <GitDiff size={13} weight={activeTab === "diff" ? "bold" : "regular"} />
                  Diff
                  {diffStats && (
                    <span className="flex items-center gap-1 ml-0.5 text-meta font-mono">
                      <span className="text-st-green">+{diffStats.insertions}</span>
                      <span className="text-st-red">-{diffStats.deletions}</span>
                    </span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* URL bar and controls — only when preview is running and active */}
          {isRunning && activeTab === "preview" ? (
            <div className="flex-1 flex items-center gap-1.5 min-w-0">
              <div className="flex-1 flex items-center bg-th-muted rounded-lg px-2 h-7 min-w-0">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0 mr-1.5" />
                <span className="text-meta font-mono text-th-muted flex-shrink-0">:{workItem.preview_port}</span>
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={handleUrlSubmit}
                  onBlur={() => setUrlInput(path)}
                  className="flex-1 min-w-0 bg-transparent text-meta font-mono text-th-primary outline-none border-none px-0"
                  spellCheck={false}
                />
              </div>
              <PreviewActionsDropdown
                onRefresh={handleRefresh}
                openUrl={directUrl!}
                onStop={onStopPreview}
                stoppingPreview={stoppingPreview}
              />
            </div>
          ) : (
            <div className="flex-1" />
          )}
        </div>

        {/* Error banner */}
        {previewError && activeTab === "preview" && (
          <div className="px-3 py-1.5 bg-st-red border-b border-st-red">
            <p className="text-xs text-st-red">{previewError}</p>
          </div>
        )}

        {/* Main content area — preview or diff */}
        <div className="flex-1 overflow-hidden bg-th-subtle flex items-center justify-center relative">
          {/* Preview — keep iframe mounted but hidden to preserve state */}
          <div
            className="absolute inset-0"
            style={{ display: activeTab === "preview" ? "flex" : "none", alignItems: "center", justifyContent: "center" }}
          >
            {isRunning && previewUrl ? (
              <div className="w-full h-full">
                <iframe
                  ref={ref}
                  src={previewUrl}
                  className="w-full h-full border-0"
                  title="Preview"
                />
              </div>
            ) : (
              <div className="text-center px-6">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-th-muted flex items-center justify-center">
                  <Eye size={24} className="text-th-muted" />
                </div>
                <p className="text-sm text-th-muted mb-3">
                  {canPreview ? "Start a preview to see your app here" : "No directory available for preview"}
                </p>
                {canPreview && !isRunning && (
                  <button
                    onClick={onStartPreview}
                    disabled={startingPreview}
                    className="px-4 py-2 bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover disabled:opacity-50 text-sm font-medium transition-colors"
                  >
                    {startingPreview ? "Starting..." : "Start Preview"}
                  </button>
                )}
              </div>
            )}

            {/* Narration overlay */}
            {narrationText && (
              <div className="absolute top-3 left-3 right-3 z-10 px-4 py-3 rounded-xl bg-th-overlay border border-th shadow-2xl">
                <p className="text-sm text-white italic leading-relaxed">&ldquo;{narrationText}&rdquo;</p>
              </div>
            )}
          </div>

          {/* Diff */}
          {activeTab === "diff" && canDiff && (
            <div className="absolute inset-0">
              <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-th-muted">Loading...</div>}>
                <DiffPanel appId={appId} itemId={workItem.id} highlightFile={diffHighlightFile} />
              </Suspense>
            </div>
          )}

        </div>

        {/* Bottom drawer — Console + Logs tabs */}
        {canPreview && (
          <div className="flex-shrink-0 border-t border-th">
            {/* Drawer header — tabs + toggle */}
            <div
              className="w-full flex items-center justify-between px-2 py-1"
            >
              <div className="flex items-center gap-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); setDrawerTab("console"); setDrawerOpen(true); }}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    drawerOpen && drawerTab === "console"
                      ? "bg-th-muted text-th-primary"
                      : "text-th-muted hover:text-th-secondary"
                  }`}
                >
                  <MonitorPlay size={12} />
                  Console
                  {consoleErrorCount > 0 && (
                    <span className="text-meta font-medium bg-st-red text-st-red px-1.5 rounded-full">
                      {consoleErrorCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDrawerTab("logs"); setDrawerOpen(true); }}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    drawerOpen && drawerTab === "logs"
                      ? "bg-th-muted text-th-primary"
                      : "text-th-muted hover:text-th-secondary"
                  }`}
                >
                  <ListBullets size={12} />
                  Logs
                </button>
              </div>
              <button
                onClick={() => setDrawerOpen(!drawerOpen)}
                aria-expanded={drawerOpen}
                aria-label={drawerOpen ? "Collapse drawer" : "Expand drawer"}
                className="p-0.5 text-th-dimmed hover:text-th-secondary transition-colors rounded"
              >
                {drawerOpen ? <CaretDown size={11} /> : <CaretUp size={11} />}
              </button>
            </div>

            {/* Drawer content */}
            {drawerOpen && (
              <div style={{ height: drawerHeight }} className="overflow-hidden">
                <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-th-muted">Loading...</div>}>
                  {drawerTab === "console" ? (
                    <ConsolePanel appId={appId} workItemId={workItem.id} onErrorCount={setConsoleErrorCount} />
                  ) : (
                    <LogsPanel appId={appId} itemId={workItem.id} />
                  )}
                </Suspense>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

export default PreviewPanel;
