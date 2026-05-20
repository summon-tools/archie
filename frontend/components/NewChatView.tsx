"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { createWorkItem, getRemoteBranches, importExistingBranch, type ModelConfig, type RemoteBranchesResponse } from "@/lib/api";
import { fetcher } from "@/lib/swr";
import ChatInput from "@/components/ChatInput";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { tools } from "@/tools/registry";
import type { AppFile } from "@/lib/types";
import { ArrowsClockwise, CaretDown, GitBranch, MagnifyingGlass, SpinnerGap } from "@phosphor-icons/react";

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
  const [branchName, setBranchName] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [importingBranch, setImportingBranch] = useState(false);
  const branchPickerRef = useRef<HTMLDivElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);
  const { selectedModel, selectedProvider, handleModelChange } = useSelectedModel();
  const { data: modelConfig } = useSWR<ModelConfig>("/api/models/config", fetcher);
  const {
    data: remoteBranches,
    error: remoteBranchesError,
    isLoading: remoteBranchesLoading,
    isValidating: remoteBranchesValidating,
    mutate: refreshRemoteBranches,
  } = useSWR<RemoteBranchesResponse>(["remote-branches", appId], () => getRemoteBranches(appId));
  const branchOptions = remoteBranches?.branches || [];
  const checkedOutBranchOptions = remoteBranches?.checked_out_branches || [];
  const branchesRefreshing = remoteBranchesLoading || remoteBranchesValidating;
  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    if (!query) return branchOptions;
    return branchOptions.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchOptions, branchQuery]);
  const filteredCheckedOutBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    if (!query) return checkedOutBranchOptions;
    return checkedOutBranchOptions.filter((branch) => branch.toLowerCase().includes(query));
  }, [checkedOutBranchOptions, branchQuery]);

  useEffect(() => {
    if (!branchPickerOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (branchPickerRef.current && !branchPickerRef.current.contains(event.target as Node)) {
        setBranchPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [branchPickerOpen]);

  useEffect(() => {
    if (branchPickerOpen) {
      void refreshRemoteBranches();
      branchInputRef.current?.focus();
      branchInputRef.current?.select();
    }
  }, [branchPickerOpen, refreshRemoteBranches]);

  useEffect(() => {
    if (branchName && remoteBranches && !remoteBranches.branches.includes(branchName)) {
      setBranchName("");
      setBranchQuery("");
    }
  }, [branchName, remoteBranches]);

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

  const handleImportBranch = async () => {
    const branch = branchName.trim();
    if (!branch || importingBranch || sending) return;
    setImportingBranch(true);
    setError(null);
    try {
      const item = await importExistingBranch(appId, branch);
      setBranchName("");
      setBranchQuery("");
      setBranchPickerOpen(false);
      onItemCreated(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open branch");
    } finally {
      setImportingBranch(false);
    }
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

          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleImportBranch();
            }}
            className="max-w-xs mx-auto mt-8"
          >
            <div className="relative flex items-center gap-2 px-2 py-1.5 rounded-lg bg-th-subtle border border-th" ref={branchPickerRef}>
              <GitBranch size={15} className="text-th-muted flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => {
                    if (importingBranch || sending) return;
                    setBranchPickerOpen((open) => !open);
                  }}
                  disabled={importingBranch || sending}
                  className="w-full min-w-0 flex items-center justify-between gap-2 bg-transparent text-left text-sm text-th-primary disabled:text-th-dimmed focus:outline-none"
                  aria-haspopup="listbox"
                  aria-expanded={branchPickerOpen}
                >
                  <span className={`min-w-0 truncate ${branchName ? "text-th-primary" : "text-th-dimmed"}`}>
                    {remoteBranchesLoading && branchOptions.length === 0
                      ? "Loading remote branches..."
                      : remoteBranchesError
                        ? "Branches unavailable"
                        : branchOptions.length === 0
                          ? "No available branches"
                          : branchName || "Select remote branch"}
                  </span>
                  <CaretDown size={12} className="text-th-muted flex-shrink-0" />
                </button>

                {branchPickerOpen && (
                  <div className="absolute left-0 right-0 top-full mt-2 bg-th-elevated border border-th rounded-lg shadow-xl overflow-hidden z-50 text-left">
                    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-th bg-th-subtle">
                      <MagnifyingGlass size={13} className="text-th-muted flex-shrink-0" />
                      <input
                        ref={branchInputRef}
                        type="text"
                        value={branchQuery}
                        onChange={(event) => {
                          setBranchQuery(event.target.value);
                          if (event.target.value !== branchName) setBranchName("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setBranchPickerOpen(false);
                          }
                          if (event.key === "Enter" && !branchName && filteredBranches.length > 0) {
                            event.preventDefault();
                            setBranchName(filteredBranches[0]);
                            setBranchQuery(filteredBranches[0]);
                            setBranchPickerOpen(false);
                          }
                        }}
                        placeholder="Search branches..."
                        className="min-w-0 flex-1 bg-transparent text-sm text-th-primary placeholder:text-th-dimmed focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void refreshRemoteBranches();
                        }}
                        disabled={branchesRefreshing}
                        title="Refresh remote branches"
                        aria-label="Refresh remote branches"
                        className="flex-shrink-0 rounded p-1 text-th-muted transition-colors hover:bg-th-muted hover:text-th-primary disabled:opacity-60"
                      >
                        <ArrowsClockwise size={13} className={branchesRefreshing ? "animate-spin" : ""} />
                      </button>
                    </div>
                    <div role="listbox" className="max-h-52 overflow-y-auto py-1">
                      {remoteBranchesError ? (
                        <div className="px-3 py-2 text-xs text-th-dimmed">Could not load branches</div>
                      ) : filteredBranches.length === 0 && filteredCheckedOutBranches.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-th-dimmed">
                          {branchesRefreshing
                            ? "Refreshing branches..."
                            : branchQuery.trim()
                              ? "No matching branches"
                              : "No available branches"}
                        </div>
                      ) : (
                        <>
                          {filteredBranches.map((branch) => (
                            <button
                              key={branch}
                              type="button"
                              role="option"
                              aria-selected={branchName === branch}
                              onClick={() => {
                                setBranchName(branch);
                                setBranchQuery(branch);
                                setBranchPickerOpen(false);
                              }}
                              className={`w-full min-w-0 px-3 py-1.5 text-left text-xs transition-colors ${
                                branchName === branch
                                  ? "bg-th-muted text-th-primary"
                                  : "text-th-secondary hover:bg-th-subtle hover:text-th-primary"
                              }`}
                              title={branch}
                            >
                              <span className="block truncate">{branch}</span>
                            </button>
                          ))}
                          {filteredCheckedOutBranches.length > 0 && (
                            <>
                              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-th-dimmed">
                                Already open
                              </div>
                              {filteredCheckedOutBranches.map((branch) => (
                                <div
                                  key={branch}
                                  title={`${branch} is already checked out locally`}
                                  className="flex min-w-0 items-center justify-between gap-2 px-3 py-1.5 text-xs text-th-dimmed"
                                >
                                  <span className="min-w-0 truncate">{branch}</span>
                                  <span className="flex-shrink-0 text-[10px] uppercase tracking-wide">In use</span>
                                </div>
                              ))}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={!branchName.trim() || importingBranch || sending}
                className="px-2 py-1 rounded-md text-xs font-medium bg-btn-secondary text-btn-secondary hover:bg-btn-secondary-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importingBranch ? <SpinnerGap size={13} className="animate-spin" /> : "Open"}
              </button>
            </div>
          </form>

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
