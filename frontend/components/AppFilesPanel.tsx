"use client";

import { useCallback, useEffect, useState } from "react";
import { DownloadSimple, FileText, SpinnerGap, Trash } from "@phosphor-icons/react";
import { deleteAppFile, getAppFiles } from "@/lib/api";
import type { AppFile } from "@/lib/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function AppFilesPanel({ appId }: { appId: number }) {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFiles(await getAppFiles(appId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handleDelete = async (file: AppFile) => {
    if (!window.confirm(`Delete ${file.original_name}? Existing message cards will show it as unavailable.`)) return;
    setDeletingId(file.id);
    setError(null);
    try {
      await deleteAppFile(appId, file.id);
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete file");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 bg-th-main">
      <header className="h-10 border-b border-th px-6 flex items-center">
        <h2 className="text-sm font-semibold text-th-primary">Files</h2>
      </header>

      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-5">
          <p className="text-sm text-th-secondary">
            Durable project files uploaded from room and task chats.
          </p>
          <p className="mt-1 text-xs text-th-muted">
            Agents receive readable local paths only when the file is attached to the current room or conversation context.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-st-red bg-st-red px-3 py-2 text-sm text-st-red-strong">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-th-muted">
            <SpinnerGap size={16} className="animate-spin" />
            Loading files...
          </div>
        ) : files.length === 0 ? (
          <div className="rounded-lg border border-dashed border-th p-8 text-center">
            <FileText size={24} className="mx-auto mb-3 text-th-muted" />
            <p className="text-sm font-medium text-th-secondary">No files yet</p>
            <p className="mt-1 text-xs text-th-muted">Attach files from a room or task chat to add them here.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-th">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-th bg-th-panel text-xs uppercase tracking-wide text-th-dimmed">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Uploaded</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className="border-b border-th last:border-0">
                    <td className="min-w-0 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="flex-shrink-0 text-th-muted" />
                        <span className="truncate text-th-primary" title={file.original_name}>{file.original_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-th-muted">{file.content_type || "unknown"}</td>
                    <td className="px-3 py-2 text-xs text-th-muted">{formatBytes(file.size_bytes)}</td>
                    <td className="px-3 py-2 text-xs text-th-muted">{formatDate(file.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <a
                          href={file.download_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md p-1.5 text-th-muted transition-colors hover:bg-th-muted hover:text-th-primary"
                          title="Download"
                        >
                          <DownloadSimple size={15} />
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleDelete(file)}
                          disabled={deletingId === file.id}
                          className="rounded-md p-1.5 text-th-muted transition-colors hover:bg-th-muted hover:text-st-red disabled:opacity-50"
                          title="Delete"
                        >
                          {deletingId === file.id ? <SpinnerGap size={15} className="animate-spin" /> : <Trash size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
