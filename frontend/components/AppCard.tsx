"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App } from "@/lib/types";
import { startApp, stopApp, restartApp, deleteApp, getApp } from "@/lib/api";
import { Trash } from "@phosphor-icons/react";

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
  isAdmin?: boolean;
}

export default function AppCard({ app, onUpdate, isAdmin = true }: AppCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const totalTasks =
    app.work_item_counts.in_progress + app.work_item_counts.done;

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

  const handleDelete = async (deleteFiles: boolean) => {
    setDeleting(true);
    try {
      await deleteApp(app.id, deleteFiles);
      setShowDeleteModal(false);
      onUpdate();
    } catch (err) {
      console.error("Failed to delete app:", err);
    } finally {
      setDeleting(false);
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
          <p className="text-xs text-th-dimmed truncate mt-1">{app.description}</p>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          {totalTasks > 0 && (
            <span className="text-xs text-th-dimmed">
              {totalTasks} conversation{totalTasks !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Action error */}
        {actionError && (
          <p className="text-xs text-st-red mt-2">{actionError}</p>
        )}

        {/* Actions */}
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
          {isAdmin && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowDeleteModal(true);
              }}
              className="p-1 text-th-dimmed hover:text-st-red rounded transition-colors ml-auto"
              title="Delete"
            >
              <Trash size={14} weight="bold" />
            </button>
          )}
        </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 bg-overlay-heavy flex items-center justify-center z-50"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowDeleteModal(false);
          }}
        >
          <div
            className="bg-th-elevated border border-th rounded-2xl p-6 max-w-md w-full mx-4"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <h3 className="text-lg font-bold text-th-primary mb-2">
              Delete {app.name}?
            </h3>
            <p className="text-sm text-th-muted mb-1">
              This will remove the app from the dashboard and delete all its tasks, messages, and chat history.
            </p>
            {app.directory && (
              <p className="text-xs text-th-dimmed mb-4 font-mono">
                {app.directory}
              </p>
            )}

            <div className="space-y-2">
              <button
                onClick={() => handleDelete(false)}
                disabled={deleting}
                className="w-full px-4 py-2.5 bg-st-red text-st-red-strong border border-st-red rounded-lg hover:bg-st-red-hover text-sm font-medium transition disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Remove from dashboard only"}
              </button>
              <button
                onClick={() => handleDelete(true)}
                disabled={deleting}
                className="w-full px-4 py-2.5 bg-st-red text-st-red border border-st-red rounded-lg hover:bg-st-red-hover text-sm font-medium transition disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete project folder too"}
              </button>
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="w-full px-4 py-2 text-th-muted hover:text-th-primary text-sm transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
