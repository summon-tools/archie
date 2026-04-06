"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SpinnerGap, CheckCircle, WarningCircle, Clock } from "@phosphor-icons/react";
import { App, ClaudeStatusResponse } from "@/lib/types";
import { getApp, getWorkItem, getConversationClaudeStatus, stopConversationClaude, streamConversationMessage, updateWorkItem } from "@/lib/api";
import Header from "@/components/Header";
import ToolActivity from "@/components/ToolActivity";
import { getToolSummary } from "@/lib/toolSummary";

export default function BuildProgressPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const appId = Number(params.id);
  const itemId = Number(searchParams.get("taskId"));
  const model = searchParams.get("model") || undefined;
  const provider = searchParams.get("provider") || undefined;

  const [app, setApp] = useState<App | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);
  const [logContent, setLogContent] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [toolActivities, setToolActivities] = useState<{tool: string; summary: string; active: boolean}[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const streamStartedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load app info and resolve conversation ID
  useEffect(() => {
    if (appId) {
      getApp(appId).then(setApp).catch(console.error);
    }
    if (appId && itemId) {
      getWorkItem(appId, itemId).then(wi => {
        if (wi.primary_conversation_id) setConversationId(wi.primary_conversation_id);
      }).catch(console.error);
    }
  }, [appId, itemId]);

  // Start streaming or fall back to polling
  useEffect(() => {
    if (!appId || !itemId || !conversationId || streamStartedRef.current) return;
    streamStartedRef.current = true;

    const startStream = async () => {
      try {
        const response = await streamConversationMessage(appId, conversationId, "Please build this app now.", model, false, provider);
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const abort = new AbortController();
        abortRef.current = abort;

        setBuildStatus("running");

        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";

        while (true) {
          if (abort.signal.aborted) break;

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by double newlines
          const events = buffer.split("\n\n");
          buffer = events.pop() || ""; // Keep incomplete event in buffer

          for (const event of events) {
            if (!event.trim()) continue;
            let eventType = "";
            let dataStr = "";
            for (const line of event.split("\n")) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                dataStr += line.slice(6);
              }
            }
            if (!dataStr) continue;
            try {
              const parsed = JSON.parse(dataStr);

              if (eventType === "text" && parsed.text) {
                accumulated += parsed.text;
                setLogContent(accumulated);
              } else if (eventType === "tool_start" && parsed.tool) {
                setToolActivities(prev => [...prev.slice(-4), { tool: parsed.tool, summary: parsed.tool, active: true }]);
              } else if (eventType === "tool_end" && parsed.tool) {
                const summary = getToolSummary(parsed.tool, parsed.input || null);
                setToolActivities(prev => {
                  const updated = [...prev];
                  const lastActive = updated.findLastIndex(a => a.tool === parsed.tool && a.active);
                  if (lastActive >= 0) updated[lastActive] = { tool: parsed.tool, summary, active: false };
                  return updated.slice(-5);
                });
              } else if (eventType === "status") {
                setBuildStatus(parsed.status);
                setToolActivities(prev => prev.map(a => a.active ? { ...a, active: false } : a));
                if (parsed.status === "completed") {
                  updateWorkItem(appId, itemId, { status: "done" }).catch(() => {});
                  getApp(appId).then(setApp).catch(console.error);
                } else if (parsed.status === "failed") {
                  getApp(appId).then(setApp).catch(console.error);
                }
              } else if (eventType === "done") {
                setToolActivities(prev => prev.map(a => a.active ? { ...a, active: false } : a));
                if (!accumulated) {
                  // No streaming content arrived; use final status from DB
                  try {
                    const status = await getConversationClaudeStatus(appId, conversationId!);
                    if (status.claude_log) setLogContent(status.claude_log);
                    setBuildStatus(status.claude_status || "completed");
                  } catch {}
                }
                getApp(appId).then(setApp).catch(console.error);
              } else if (eventType === "error") {
                setBuildStatus("failed");
                setToolActivities(prev => prev.map(a => a.active ? { ...a, active: false } : a));
                setLogContent((prev) => prev + `\nError: ${parsed.error}`);
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }

        abortRef.current = null;
      } catch (err: any) {
        // If 409 (task already running), fall back to polling
        if (err.message?.includes("already running") || err.message?.includes("409")) {
          startPolling();
        } else if (err.name !== "AbortError") {
          // Try polling as fallback for other errors too
          startPolling();
        }
      }
    };

    const startPolling = () => {
      setIsPolling(true);
      const poll = async () => {
        try {
          const status = await getConversationClaudeStatus(appId, conversationId!);
          setBuildStatus(status.claude_status);
          if (status.claude_log) setLogContent(status.claude_log);

          if (
            status.claude_status === "completed" ||
            status.claude_status === "failed"
          ) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setIsPolling(false);
            if (status.claude_status === "completed") {
              updateWorkItem(appId, itemId, { status: "done" }).catch(() => {});
            }
            getApp(appId).then(setApp).catch(console.error);
          }
        } catch (err) {
          console.error("Poll error:", err);
        }
      };

      poll();
      pollingRef.current = setInterval(poll, 2000);
    };

    startStream();

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [appId, itemId, conversationId]);

  // Auto-scroll
  const isBuilding = buildStatus === "running";
  useEffect(() => {
    if (autoScroll && isBuilding) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logContent, autoScroll, isBuilding]);

  const handleStop = async () => {
    try {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      await stopConversationClaude(appId, conversationId!);
      setBuildStatus("failed");
    } catch (err) {
      console.error("Failed to stop:", err);
    }
  };

  const isActive = buildStatus === "running" || buildStatus === "waiting_approval";
  const isCompleted = buildStatus === "completed";
  const isFailed = buildStatus === "failed";

  return (
    <>
      <Header />

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Status Banner */}
        <div className="bg-th-surface rounded-2xl border border-th p-6">
          {isActive && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-st-blue rounded-lg flex items-center justify-center">
                  <SpinnerGap size={20} className="text-blue-600 animate-spin" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-th-primary">
                    AI is building your app...
                  </h2>
                  <p className="text-sm text-th-dimmed">
                    {isPolling
                      ? "Watching progress... (reconnected)"
                      : "Streaming live output from the AI."}
                  </p>
                </div>
              </div>
              <button
                onClick={handleStop}
                className="px-4 py-2 text-sm bg-st-red text-st-red-strong rounded-lg hover:bg-st-red-hover font-medium transition"
              >
                Stop
              </button>
            </div>
          )}

          {isCompleted && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-st-green-hover rounded-lg flex items-center justify-center">
                  <CheckCircle size={20} className="text-green-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-th-primary">
                    App built successfully!
                  </h2>
                  <p className="text-sm text-th-dimmed">
                    {app?.name} is ready. You can start it from the app page.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/apps/${appId}`}
                  className="px-4 py-2 text-sm bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover font-medium transition"
                >
                  Go to App
                </Link>
                <Link
                  href="/"
                  className="px-4 py-2 text-sm bg-btn-ghost-hover text-btn-ghost rounded-lg hover:bg-btn-secondary-hover hover:text-btn-secondary font-medium transition"
                >
                  Dashboard
                </Link>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-st-red-hover rounded-lg flex items-center justify-center">
                  <WarningCircle size={20} className="text-red-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-th-primary">
                    Build failed
                  </h2>
                  <p className="text-sm text-th-dimmed">
                    Something went wrong. Check the logs below for details.
                  </p>
                </div>
              </div>
              <Link
                href="/"
                className="px-4 py-2 text-sm bg-btn-ghost-hover text-btn-ghost rounded-lg hover:bg-btn-secondary-hover hover:text-btn-secondary font-medium transition"
              >
                Back to Dashboard
              </Link>
            </div>
          )}

          {!buildStatus && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-th-muted rounded-lg flex items-center justify-center">
                <Clock size={20} className="text-th-muted animate-pulse" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-th-primary">
                  Starting build...
                </h2>
                <p className="text-sm text-th-dimmed">
                  Connecting to the AI...
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Build Log */}
        <div className="bg-th-surface rounded-2xl border border-th p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-th-secondary flex items-center gap-2">
              {isActive && (
                <span className="flex items-center gap-1.5 text-green-600">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <span className="text-xs font-semibold">LIVE</span>
                  {isPolling && (
                    <span className="text-[10px] text-th-muted ml-1">
                      (polling)
                    </span>
                  )}
                </span>
              )}
              Build Output
            </h3>
            <div className="flex items-center gap-3">
              {logContent && (
                <span className="text-xs text-th-dimmed">
                  {logContent.split("\n").length} lines
                </span>
              )}
              {isActive && (
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`text-xs px-2 py-1 rounded ${
                    autoScroll
                      ? "bg-st-green-hover text-st-green"
                      : "bg-th-muted text-th-muted"
                  }`}
                >
                  {autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
                </button>
              )}
            </div>
          </div>
          {toolActivities.length > 0 && (
            <div className="mb-3 space-y-1">
              {toolActivities.map((a, i) => (
                <ToolActivity key={i} tool={a.tool} summary={a.summary} active={a.active} />
              ))}
            </div>
          )}
          <div className="bg-th-code-block text-th-secondary rounded-lg p-4 font-mono text-xs max-h-[500px] overflow-y-auto border border-th scroll-smooth">
            {logContent ? (
              <pre className="whitespace-pre-wrap break-words">
                {logContent}
              </pre>
            ) : (
              <div className="text-th-dimmed italic flex items-center gap-2">
                <SpinnerGap size={16} className="animate-spin" />
                Waiting for output...
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* App Info */}
        {app && (
          <div className="bg-th-subtle rounded-xl border border-th p-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-th-dimmed">Name</span>
                <p className="font-medium text-th-primary">{app.name}</p>
              </div>
              <div>
                <span className="text-th-dimmed">Port</span>
                <p className="font-medium text-th-primary">{app.port}</p>
              </div>
              <div>
                <span className="text-th-dimmed">Directory</span>
                <p className="font-medium text-th-primary font-mono text-xs">
                  {app.directory}
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
