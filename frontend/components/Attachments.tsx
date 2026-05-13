"use client";

import { useRef, useState } from "react";
import { DownloadSimple, FileText, Paperclip, SpinnerGap, X } from "@phosphor-icons/react";
import { uploadAppFile } from "@/lib/api";
import type { AppFile, MessageAttachment } from "@/lib/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentUploadTray({
  appId,
  attachments,
  onChange,
  disabled,
}: {
  appId: number;
  attachments: AppFile[];
  onChange: (files: AppFile[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || disabled) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: AppFile[] = [];
      for (const file of Array.from(fileList)) {
        uploaded.push(await uploadAppFile(appId, file));
      }
      const seen = new Set<number>();
      onChange([...attachments, ...uploaded].filter((file) => {
        if (seen.has(file.id)) return false;
        seen.add(file.id);
        return true;
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((file) => (
            <div
              key={file.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-th bg-th-subtle px-2 py-1 text-xs text-th-secondary"
              title={`${file.original_name} · ${formatBytes(file.size_bytes)}`}
            >
              <FileText size={13} className="flex-shrink-0 text-th-muted" />
              <span className="max-w-44 truncate">{file.original_name}</span>
              <span className="text-th-dimmed">{formatBytes(file.size_bytes)}</span>
              <button
                type="button"
                onClick={() => onChange(attachments.filter((candidate) => candidate.id !== file.id))}
                className="rounded p-0.5 text-th-muted transition-colors hover:text-th-primary"
                title="Remove attachment"
                aria-label={`Remove ${file.original_name}`}
              >
                <X size={11} weight="bold" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="inline-flex items-center gap-1 px-1 py-0.5 text-xs text-th-muted transition-colors hover:text-th-primary disabled:opacity-50"
          title="Attach files"
        >
          {uploading ? (
            <SpinnerGap size={12} className="animate-spin" />
          ) : (
            <Paperclip size={12} weight="bold" />
          )}
          Attach
        </button>
        {error && <span className="text-xs text-st-red">{error}</span>}
      </div>
    </div>
  );
}

export function MessageAttachmentList({ attachments }: { attachments?: MessageAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((file) => {
        const available = file.status === "available";
        const card = (
          <div
            className={`inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
              available
                ? "border-th bg-th-subtle text-th-secondary hover:bg-th-muted"
                : "border-th bg-th-subtle text-th-dimmed"
            }`}
            title={`${file.original_name} · ${formatBytes(file.size_bytes)}`}
          >
            <FileText size={14} className="flex-shrink-0 text-th-muted" />
            <span className="max-w-48 truncate font-medium">{file.original_name}</span>
            <span className="text-th-dimmed">{formatBytes(file.size_bytes)}</span>
            {available ? <DownloadSimple size={13} className="flex-shrink-0 text-th-muted" /> : <span>unavailable</span>}
          </div>
        );

        return available ? (
          <a key={file.id} href={file.download_url} target="_blank" rel="noreferrer">
            {card}
          </a>
        ) : (
          <div key={file.id}>{card}</div>
        );
      })}
    </div>
  );
}
