"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Stop, SpinnerGap, ArrowUp, Lightning, X, CaretDown } from "@phosphor-icons/react";
import { AttachmentUploadTray } from "@/components/Attachments";
import { fetchGlobalSkillSummaries } from "@/lib/api";
import type { AppFile, GlobalSkillSummary } from "@/lib/types";
import type { Tool } from "@/tools/types";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  statusText?: string;
  showStopButton?: boolean;
  onStop?: () => void;
  model?: string;
  provider?: string;
  onModelChange?: (provider: string, model: string) => void;
  availableModels?: { id: string; label: string; provider: string }[];
  tools?: Tool[];
  pinnedToolId?: string | null;
  onPinTool?: (toolId: string | null) => void;
  toolsBusy?: boolean;
  branchName?: string | null;
  isWorktree?: boolean;
  appId?: number;
  attachments?: AppFile[];
  onAttachmentsChange?: (files: AppFile[]) => void;
}

export default function ChatInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Ask the AI...",
  disabled = false,
  isLoading = false,
  statusText,
  showStopButton = false,
  onStop,
  model,
  provider,
  onModelChange,
  availableModels,
  tools: availableTools,
  pinnedToolId,
  onPinTool,
  toolsBusy = false,
  branchName,
  isWorktree,
  appId,
  attachments = [],
  onAttachmentsChange,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [globalSkills, setGlobalSkills] = useState<GlobalSkillSummary[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  const pinnedTool = pinnedToolId && availableTools
    ? availableTools.find((s) => s.id === pinnedToolId)
    : null;

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = 4 * 24;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    let cancelled = false;
    fetchGlobalSkillSummaries()
      .then((data) => {
        if (!cancelled) setGlobalSkills(data.skills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Close picker on click outside
  useEffect(() => {
    if (!showToolPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowToolPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showToolPicker]);

  // Focus textarea when a tool is pinned
  useEffect(() => {
    if (pinnedToolId && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [pinnedToolId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if ((value.trim() || attachments.length > 0) && !disabled && !isLoading) {
        onSubmit();
      }
    }
    // Escape clears pinned tool
    if (e.key === "Escape" && pinnedToolId && onPinTool) {
      onPinTool(null);
    }
  };

  const canSend = (value.trim() || attachments.length > 0) && !disabled && !isLoading;
  const skillQueryMatch = value.match(/(^|\s)\/([a-z0-9._-]*)$/i);
  const skillQuery = skillQueryMatch ? skillQueryMatch[2].toLowerCase() : null;
  const skillSuggestions = skillQuery === null || disabled || isLoading
    ? []
    : globalSkills
        .filter((skill) => (
          skill.slug.includes(skillQuery) ||
          skill.name.toLowerCase().includes(skillQuery)
        ))
        .slice(0, 6);

  const insertGlobalSkill = (skill: GlobalSkillSummary) => {
    const nextValue = value.replace(/(^|\s)\/([a-z0-9._-]*)$/i, `$1/${skill.slug} `);
    onChange(nextValue);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  return (
    <div className="flex-shrink-0 bg-transparent px-4 py-3">
      <div className="max-w-chat mx-auto">
        {/* Status text */}
        {statusText && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-xs text-th-muted">{statusText}</span>
          </div>
        )}

        {/* Pinned tool context bar */}
        {pinnedTool && onPinTool && (
          <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-brand-500/10 border border-brand-400/20 rounded-lg">
            {(() => { const Icon = pinnedTool.icon; return <Icon size={14} weight="bold" className="text-brand-400" />; })()}
            <span className="text-xs font-medium text-brand-400">{pinnedTool.name}</span>
            <span className="text-meta text-th-muted">mode</span>
            <button
              onClick={() => onPinTool(null)}
              className="ml-auto p-0.5 text-th-muted hover:text-th-primary rounded transition-colors"
              title="Clear tool (Esc)"
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        )}

        {/* Input container */}
        <div
          className={`relative flex flex-col rounded-xl border bg-th-elevated px-4 py-2 transition-all shadow-sm ${
            disabled
              ? "border-th opacity-80"
              : pinnedTool
                ? "border-brand-400/40 focus-within:border-brand-400/60"
                : "border-th focus-within:border-th-strong"
          }`}
        >
          {skillSuggestions.length > 0 && (
            <div className="absolute bottom-full left-3 mb-2 w-72 overflow-hidden rounded-xl border border-th bg-th-elevated shadow-xl z-50">
              {skillSuggestions.map((skill) => (
                <button
                  key={skill.slug}
                  type="button"
                  onClick={() => insertGlobalSkill(skill)}
                  className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-th-muted"
                >
                  <Lightning size={15} weight="bold" className="mt-0.5 flex-shrink-0 text-th-muted" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-th-dimmed">/{skill.slug}</span>
                      <span className="truncate text-sm font-medium text-th-primary">{skill.name}</span>
                    </div>
                    <p className="line-clamp-2 text-xs leading-5 text-th-muted">{skill.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {appId && onAttachmentsChange && (
            <div className="pb-2">
              <AttachmentUploadTray
                appId={appId}
                attachments={attachments}
                onChange={onAttachmentsChange}
                disabled={disabled || isLoading}
              />
            </div>
          )}

          {/* Textarea + send button row */}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pinnedTool ? `Describe what you want ${pinnedTool.name.toLowerCase()} to do...` : placeholder}
              disabled={disabled}
              rows={1}
              className="flex-1 resize-none border-none bg-transparent text-sm text-th-primary placeholder:text-th-dimmed focus:outline-none focus:ring-0 disabled:opacity-50 leading-6"
            />

            <div className="flex items-center gap-2 flex-shrink-0">
              {showStopButton && onStop ? (
                <button
                  onClick={onStop}
                  className="flex items-center justify-center w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors active:scale-95"
                  title="Stop"
                  aria-label="Stop"
                >
                  <Stop size={14} weight="fill" />
                </button>
              ) : (
                <button
                  onClick={onSubmit}
                  disabled={!canSend}
                  className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95 ${
                    canSend
                      ? "bg-th-primary text-th-inverted hover:opacity-90"
                      : "bg-th-muted text-th-dimmed cursor-not-allowed"
                  }`}
                  title="Send message"
                  aria-label="Send message"
                >
                  {isLoading ? (
                    <SpinnerGap size={14} className="animate-spin" />
                  ) : (
                    <ArrowUp size={14} weight="bold" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Bottom row: tool picker + model selector + branch info */}
          <div className="flex items-center gap-2 pt-1.5 mt-1">
            {/* Tool picker */}
            {availableTools && availableTools.length > 0 && onPinTool && (
              <div className="relative" ref={pickerRef}>
                <button
                  type="button"
                  onClick={() => setShowToolPicker(!showToolPicker)}
                  disabled={toolsBusy}
                  className="flex items-center gap-1 text-xs px-1 py-0.5 text-th-muted hover:text-th-primary transition-colors disabled:opacity-50"
                  title="Tools"
                >
                  <Lightning size={12} weight="fill" />
                  Tools
                </button>

                {/* Dropdown */}
                {showToolPicker && !toolsBusy && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50">
                    {availableTools.map((t) => {
                      const Icon = t.icon;
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            setShowToolPicker(false);
                            onPinTool(t.id);
                          }}
                          className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-th-muted transition-colors text-left"
                        >
                          <Icon size={16} weight="bold" className="text-th-muted flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-th-primary">{t.name}</p>
                            <p className="text-meta text-th-dimmed leading-tight">{t.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Model selector — pushed to the right */}
            {model && onModelChange && availableModels && (
              <div className="relative ml-auto flex items-center">
                <select
                  value={`${provider || "claude"}:${model}`}
                  onChange={(e) => {
                    const [p, ...rest] = e.target.value.split(":");
                    onModelChange(p, rest.join(":"));
                  }}
                  className="appearance-none bg-transparent text-xs text-th-muted hover:text-th-primary cursor-pointer focus:outline-none focus:ring-0 py-0.5 pr-4 text-right"
                >
                  {Object.entries(
                    availableModels.reduce<Record<string, { id: string; label: string; provider: string }[]>>((acc, m) => {
                      (acc[m.provider] ??= []).push(m);
                      return acc;
                    }, {})
                  ).map(([providerKey, models]) => (
                    <optgroup key={providerKey} label={providerKey === "claude" ? "Claude Code" : providerKey === "codex" ? "Codex" : providerKey}>
                      {models.map((m) => (
                        <option key={`${providerKey}:${m.id}`} value={`${providerKey}:${m.id}`}>{m.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <CaretDown size={10} className="absolute right-0 top-1/2 -translate-y-1/2 text-th-muted pointer-events-none" />
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <p className="text-meta text-th-dimmed text-center mt-2 tracking-wide">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
