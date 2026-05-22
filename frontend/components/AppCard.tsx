"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App } from "@/lib/types";
import { startApp, stopApp, restartApp, getApp } from "@/lib/api";
import { ChatsCircle, CheckCircle, Lightning, User } from "@phosphor-icons/react";

async function waitForStatus(appId: number, expectRunning: boolean, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const current = await getApp(appId);
    if (current.is_running === expectRunning) return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

interface AppCardProps {
  app: App;
  onUpdate: () => void;
  ownerName?: string | null;
}

export default function AppCard({ app, onUpdate, ownerName = null }: AppCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const stats = app.conversation_stats;

  const handleAction = async (
    action: "start" | "stop" | "restart",
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(action);
    setActionError(null);
    try {
      if (action === "start") await startApp(app.id);
      else if (action === "stop") await stopApp(app.id);
      else await restartApp(app.id);
      await waitForStatus(app.id, action !== "stop");
      onUpdate();
    } catch (err) {
      setActionError(`Failed to ${action} — try again`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div
      onClick={() => router.push(`/apps/${app.id}`)}
      className="bg-th-surface rounded-xl border border-th px-5 py-4 hover:border-th-strong hover:bg-th-elevated transition-all duration-200 cursor-pointer h-full flex flex-col"
    >
        {/* Header: name + status */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 flex-shrink-0 ${
              app.is_running ? "rounded-full bg-green-500" : "rounded-sm bg-th-strong"
            }`}
            title={app.is_running ? "Running" : "Stopped"}
          />
          <h2 className="text-sm font-semibold text-th-primary truncate">{app.name}</h2>
          {app.is_running && (
            <a
              href={`/api/p/${app.port}/`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-meta px-2 py-0.5 bg-th-muted text-th-secondary rounded font-medium hover:bg-th-subtle hover:text-th-primary transition-colors flex-shrink-0 ml-auto"
            >
              View app
            </a>
          )}
        </div>

        {app.description && (
          <p className="text-xs text-th-dimmed mt-1 line-clamp-2">{app.description}</p>
        )}

        {/* Meta row */}
        {stats.total > 0 && (
          <div className="flex items-center gap-3 mt-2.5 flex-wrap">
            <span
              className="flex items-center gap-1 text-xs text-th-dimmed"
              title={`${stats.total} conversation${stats.total !== 1 ? "s" : ""}`}
            >
              <ChatsCircle size={12} weight="bold" />
              {stats.total}
            </span>
            <span
              className="flex items-center gap-1 text-xs text-th-dimmed"
              title={`${stats.open} open conversation${stats.open !== 1 ? "s" : ""}`}
            >
              <CheckCircle size={12} weight="bold" />
              {stats.open}
            </span>
            <span
              className={`flex items-center gap-1 text-xs ${
                stats.previews_running > 0 ? "text-st-green" : "text-th-dimmed"
              }`}
              title={`${stats.previews_running} preview server${stats.previews_running !== 1 ? "s" : ""} running`}
            >
              <Lightning size={12} weight="bold" />
              {stats.previews_running}
            </span>
          </div>
        )}

        {/* Action error */}
        {actionError && (
          <p className="text-xs text-st-red mt-2">{actionError}</p>
        )}

        {/* Actions + owner */}
        <div className="flex items-center gap-1.5 mt-auto pt-3">
          {app.is_running ? (
            <>
              <button
                onClick={(e) => handleAction("restart", e)}
                disabled={loading !== null}
                className="text-meta px-2 py-1 bg-st-blue text-st-blue rounded-md hover:bg-st-blue-hover font-medium transition disabled:opacity-50"
              >
                {loading === "restart" ? "..." : "Restart"}
              </button>
              {app.id !== 1 && (
                <button
                  onClick={(e) => handleAction("stop", e)}
                  disabled={loading !== null}
                  className="text-meta px-2 py-1 bg-st-red text-st-red-strong rounded-md hover:bg-st-red-hover font-medium transition disabled:opacity-50"
                >
                  {loading === "stop" ? "..." : "Stop"}
                </button>
              )}
            </>
          ) : (
            <button
              onClick={(e) => handleAction("start", e)}
              disabled={loading !== null}
              className="text-meta px-2 py-1 bg-st-green text-st-green rounded-md hover:bg-st-green-hover font-medium transition disabled:opacity-50"
            >
              {loading === "start" ? "..." : "Start"}
            </button>
          )}
          {ownerName && (
            <span
              className="flex items-center gap-1 text-xs text-th-dimmed ml-auto min-w-0"
              title={ownerName}
            >
              <User size={12} weight="bold" className="flex-shrink-0" />
              <span className="truncate">{ownerName}</span>
            </span>
          )}
        </div>
    </div>
  );
}
