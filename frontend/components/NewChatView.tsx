"use client";

import { useState } from "react";
import useSWR from "swr";
import { createWorkItem, type ModelConfig } from "@/lib/api";
import { fetcher } from "@/lib/swr";
import ChatInput from "@/components/ChatInput";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { tools } from "@/tools/registry";
import type { AppFile } from "@/lib/types";

interface NewChatViewProps {
  appId: number;
  onItemCreated: (item: any) => void;
  initialMessage?: string;
}

export default function NewChatView({ appId, onItemCreated, initialMessage }: NewChatViewProps) {
  const [message, setMessage] = useState(initialMessage || "");
  const [attachments, setAttachments] = useState<AppFile[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinnedToolId, setPinnedToolId] = useState<string | null>(null);
  const { selectedModel, selectedProvider, handleModelChange } = useSelectedModel();
  const { data: modelConfig } = useSWR<ModelConfig>("/api/models/config", fetcher);

  const handleSubmit = async () => {
    if ((!message.trim() && attachments.length === 0) || sending) return;
    const currentAttachments = attachments;
    setSending(true);
    setError(null);
    try {
      const item = await createWorkItem(appId, message.trim(), undefined, currentAttachments.map((file) => file.id));
      setMessage("");
      setAttachments([]);
      setPinnedToolId(null);
      onItemCreated(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start — try refreshing the page");
    } finally {
      setSending(false);
    }
  };

  const handleChipClick = (text: string) => {
    setMessage(text);
  };

  const taskShortcuts = [
    { label: "Add a new feature", prompt: "Add a new feature: " },
    { label: "Fix a bug", prompt: "Fix the bug: " },
    { label: "Ask a question", prompt: "How does the " },
    { label: "Walk me through the app", prompt: "Walk me through the app" },
  ];

  const contextShortcuts = [
    { label: "Update the spec", prompt: "Update the spec: " },
    { label: "Check spec drift", prompt: "Check if the spec has drifted from the codebase" },
    { label: "Refresh codebase index", prompt: "Refresh the codebase index for this project" },
    { label: "Update team skills", prompt: "Update the team skills: " },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Welcome area */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <h2 className="text-2xl font-medium text-th-primary mb-1 tracking-tight">
            What are we building?
          </h2>
          <p className="text-sm text-th-dimmed mb-10">
            Ask a question or describe what you want to build.
          </p>

          {/* Task shortcuts */}
          <div className="max-w-xs mx-auto mb-8 text-left space-y-0.5">
            {taskShortcuts.map(({ label, prompt }) => (
              <button
                key={label}
                onClick={() => handleChipClick(prompt)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-th-subtle group"
              >
                <span className="font-mono text-th-dimmed text-sm group-hover:text-th-muted transition-colors select-none">→</span>
                <span className="text-sm text-th-secondary group-hover:text-th-primary transition-colors">{label}</span>
              </button>
            ))}
          </div>

          {/* Project context shortcuts */}
          <div className="max-w-xs mx-auto text-left">
            <p className="text-meta font-semibold text-th-dimmed uppercase tracking-wider mb-2 px-2">Project Context</p>
            <div className="space-y-0.5">
              {contextShortcuts.map(({ label, prompt }) => (
                <button
                  key={label}
                  onClick={() => handleChipClick(prompt)}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-th-subtle group"
                >
                  <span className="font-mono text-th-dimmed text-meta group-hover:text-th-muted transition-colors select-none">→</span>
                  <span className="text-xs text-th-dimmed group-hover:text-th-secondary transition-colors">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-6 text-sm text-st-red bg-st-red border border-st-red rounded-xl px-3 py-2">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Chat input with model picker and tools */}
      <ChatInput
        value={message}
        onChange={setMessage}
        onSubmit={handleSubmit}
        placeholder="Message..."
        disabled={sending}
        isLoading={sending}
        appId={appId}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        model={selectedModel}
        provider={selectedProvider}
        onModelChange={handleModelChange}
        availableModels={modelConfig?.availableModels}
        tools={tools}
        pinnedToolId={pinnedToolId}
        onPinTool={setPinnedToolId}
      />
    </div>
  );
}
