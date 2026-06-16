"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, CaretDown, Lightning, SpinnerGap, UsersThree, X } from "@phosphor-icons/react";
import { AttachmentUploadTray } from "@/components/Attachments";
import { fetchGlobalSkillSummaries } from "@/lib/api";
import type { HomeAgentDefinition } from "@/lib/home/agents";
import type { AppFile, GlobalSkillSummary } from "@/lib/types";

interface RoomChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  agents: HomeAgentDefinition[];
  selectedAgentKey: string | null;
  onSelectAgent: (agentKey: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  statusText?: string;
  appId: number;
  attachments: AppFile[];
  onAttachmentsChange: (files: AppFile[]) => void;
}

export default function RoomChatInput({
  value,
  onChange,
  onSubmit,
  agents,
  selectedAgentKey,
  onSelectAgent,
  placeholder = "Discuss the plan...",
  disabled = false,
  isLoading = false,
  statusText,
  appId,
  attachments,
  onAttachmentsChange,
}: RoomChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [globalSkills, setGlobalSkills] = useState<GlobalSkillSummary[]>([]);
  const selectedAgent = selectedAgentKey
    ? agents.find((agent) => agent.key === selectedAgentKey)
    : null;

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

  useEffect(() => {
    if (!showAgentPicker) return;
    const handleClick = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowAgentPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAgentPicker]);

  useEffect(() => {
    if (selectedAgentKey && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [selectedAgentKey]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if ((value.trim() || attachments.length > 0) && !disabled && !isLoading) {
        onSubmit();
      }
    }
    if (event.key === "Escape" && selectedAgentKey) {
      onSelectAgent(null);
    }
  };

  const canSend = (value.trim() || attachments.length > 0) && !disabled && !isLoading;
  const skillQueryMatch = value.match(/(^|\s)\/([a-z0-9._-]*)$/i);
  const skillQuery = skillQueryMatch ? skillQueryMatch[2].toLowerCase() : null;
  const isSkillQueryActive = skillQuery !== null;

  useEffect(() => {
    if (!isSkillQueryActive) return;
    let cancelled = false;
    fetchGlobalSkillSummaries()
      .then((data) => {
        if (!cancelled) setGlobalSkills(data.skills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isSkillQueryActive]);

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
    <div className="flex-shrink-0 bg-transparent px-6 py-3">
      <div className="max-w-3xl mx-auto">
        {statusText && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-xs text-th-muted">{statusText}</span>
          </div>
        )}

        <div
          className={`relative flex flex-col rounded-xl border bg-th-elevated px-4 py-2 transition-all shadow-sm ${
            disabled
              ? "border-th opacity-80"
              : selectedAgent
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

          <div className="pb-2">
            <AttachmentUploadTray
              appId={appId}
              attachments={attachments}
              onChange={onAttachmentsChange}
              disabled={disabled || isLoading}
            />
          </div>

          {selectedAgent && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-brand-400/20 bg-brand-500/10 px-2.5 py-1.5">
              <UsersThree size={14} weight="bold" className="text-brand-400" />
              <span className="text-xs font-medium text-brand-400">@{selectedAgent.name}</span>
              <span className="text-meta text-th-muted">tagged</span>
              <button
                type="button"
                onClick={() => onSelectAgent(null)}
                className="ml-auto rounded p-0.5 text-th-muted transition-colors hover:text-th-primary"
                title="Clear agent tag (Esc)"
              >
                <X size={12} weight="bold" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedAgent ? `Ask ${selectedAgent.name}...` : placeholder}
              disabled={disabled}
              rows={1}
              className="flex-1 resize-none border-none bg-transparent text-sm leading-6 text-th-primary placeholder:text-th-dimmed focus:outline-none focus:ring-0 disabled:opacity-50"
            />

            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSend}
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all active:scale-95 ${
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
          </div>

          <div className="mt-1 flex items-center gap-2 pt-1.5">
            <div className="relative" ref={pickerRef}>
              <button
                type="button"
                onClick={() => setShowAgentPicker((value) => !value)}
                disabled={disabled || isLoading}
                className="flex items-center gap-1 px-1 py-0.5 text-xs text-th-muted transition-colors hover:text-th-primary disabled:opacity-50"
                title="Agents"
              >
                <UsersThree size={12} weight="fill" />
                Agents
                <CaretDown size={10} />
              </button>

              {showAgentPicker && !disabled && !isLoading && (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border border-th bg-th-elevated shadow-xl">
                  {agents.map((agent) => (
                    <button
                      key={agent.key}
                      type="button"
                      onClick={() => {
                        setShowAgentPicker(false);
                        onSelectAgent(agent.key);
                      }}
                      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-th-muted"
                    >
                      <UsersThree size={16} weight="bold" className="mt-0.5 flex-shrink-0 text-th-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-th-primary">{agent.name}</p>
                          <span className="ml-auto text-meta text-th-dimmed">{agent.defaultModel}</span>
                        </div>
                        <p className="mt-0.5 text-meta leading-tight text-th-dimmed">{agent.role}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 text-center text-meta tracking-wide text-th-dimmed">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
