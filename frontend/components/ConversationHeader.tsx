"use client";

import { useState, useRef, useEffect } from "react";
import { SpinnerGap, ArrowDown, GitPullRequest, CheckCircle, CloudArrowUp, PencilSimple, GitBranch, GitCommit, CaretDown, DotsThree, Pencil } from "@phosphor-icons/react";
import { Task, GitStatus } from "@/lib/types";

interface BranchControls {
  pushBranch: () => void;
  createPR: () => void;
  updatePR: () => void;
  pushing: boolean;
  creatingPR: boolean;
  updatingPR: boolean;
  prResult: { pr_url: string; pr_number: number } | null;
  worktreeGitStatus: GitStatus | null;
  prUrl: string | null;
  branchError: string | null;
}

interface ConversationHeaderProps {
  workItem: Task;
  isClaudeActive: boolean;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  activeClaudeStatus: string | null;
  archiving: boolean;
  handleArchive: () => void;
  handleRename: (newTitle: string) => void;
  branchControls: BranchControls;
  isArchived?: boolean;
}

function GitActionsDropdown({
  pushBranch,
  createPR,
  updatePR,
  pushing,
  creatingPR,
  updatingPR,
  hasUnpushed,
  hasPR,
  hasRemote,
  prUrl,
  prResult,
  branchName,
}: {
  pushBranch: () => void;
  createPR: () => void;
  updatePR: () => void;
  pushing: boolean;
  creatingPR: boolean;
  updatingPR: boolean;
  hasUnpushed: boolean;
  hasPR: boolean;
  hasRemote: boolean;
  prUrl: string | null;
  prResult: { pr_url: string; pr_number: number } | null;
  branchName?: string | null;
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

  const isBusy = pushing || creatingPR || updatingPR;

  let primaryLabel = "Git";
  let PrimaryIcon = GitCommit;
  if (pushing) { primaryLabel = "Committing..."; PrimaryIcon = SpinnerGap; }
  else if (creatingPR) { primaryLabel = "Creating PR..."; PrimaryIcon = SpinnerGap; }
  else if (updatingPR) { primaryLabel = "Updating PR..."; PrimaryIcon = SpinnerGap; }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={isBusy}
        aria-expanded={open}
        aria-haspopup="true"
        className="text-meta px-2.5 py-1 bg-th-muted text-th-primary hover:bg-th-elevated disabled:opacity-70 rounded-lg font-medium flex items-center gap-1.5 transition-colors"
        title={isBusy ? undefined : "Git actions (⌘⇧G)"}
      >
        <PrimaryIcon size={12} weight="bold" className={isBusy ? "animate-spin" : ""} />
        {primaryLabel}
        {!isBusy && <CaretDown size={10} className="text-th-muted" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50">
          <div className="px-3 py-1.5 border-b border-th">
            {branchName && (
              <div className="flex items-center gap-1 mb-0.5">
                <GitBranch size={11} className="text-th-dimmed flex-shrink-0" />
                <span className="text-meta font-mono text-th-muted truncate max-w-[160px]">{branchName}</span>
              </div>
            )}
            <span className="text-meta font-semibold uppercase tracking-wider text-th-dimmed">Git actions</span>
          </div>

          {hasRemote && (
            <button
              onClick={() => { pushBranch(); setOpen(false); }}
              disabled={!hasUnpushed || isBusy}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-th-muted transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CloudArrowUp size={15} weight="bold" className="text-th-muted flex-shrink-0" />
              <span className="text-th-primary text-xs">Commit & Push</span>
              {hasUnpushed && (
                <span className="ml-auto text-meta text-st-amber font-medium">&bull;</span>
              )}
            </button>
          )}

          {hasRemote && prUrl && !hasPR && (
            <button
              onClick={() => { createPR(); setOpen(false); }}
              disabled={isBusy}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-th-muted transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <GitPullRequest size={15} weight="bold" className="text-th-muted flex-shrink-0" />
              <span className="text-th-primary text-xs">Create PR</span>
            </button>
          )}

          {hasPR && (
            <button
              onClick={() => { updatePR(); setOpen(false); }}
              disabled={isBusy}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-th-muted transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <PencilSimple size={15} weight="bold" className="text-th-muted flex-shrink-0" />
              <span className="text-th-primary text-xs">Update PR</span>
            </button>
          )}

          {hasPR && prResult && (
            <a
              href={prResult.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-th-muted transition-colors text-left"
            >
              <GitPullRequest size={15} weight="bold" className="text-st-green flex-shrink-0" />
              <span className="text-th-primary text-xs">View PR #{prResult.pr_number}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function TitleDropdown({
  title,
  onMarkDone,
  archiving,
  onRename,
  isArchived,
}: {
  title: string;
  onMarkDone: () => void;
  archiving: boolean;
  onRename: (newTitle: string) => void;
  isArchived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDone, setConfirmingDone] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setRenaming(false);
        setConfirmingDone(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== title) {
      onRename(trimmed);
    }
    setRenaming(false);
    setOpen(false);
  };

  return (
    <div className="relative flex items-center gap-1 min-w-0" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-1 min-w-0 group"
      >
        <span
          className="text-sm font-medium text-th-primary truncate max-w-[140px]"
          title={title}
        >
          {title}
        </span>
        <DotsThree size={16} weight="bold" className="text-th-muted flex-shrink-0" />
      </button>

      {open && !renaming && !confirmingDone && (
        <div className="absolute left-0 top-full mt-1 w-48 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50">
          <button
            onClick={() => { setRenaming(true); setRenameValue(title); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-th-muted transition-colors text-left"
          >
            <Pencil size={15} weight="bold" className="text-th-muted flex-shrink-0" />
            <span className="text-th-primary text-xs">Rename</span>
          </button>

          {!isArchived && (
            <>
              <div className="border-t border-th mx-2" />
              <button
                onClick={() => setConfirmingDone(true)}
                disabled={archiving}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-st-red transition-colors text-left disabled:opacity-50"
              >
                <CheckCircle size={15} weight="bold" className="text-st-red flex-shrink-0" />
                <span className="text-st-red text-xs">Complete</span>
              </button>
            </>
          )}
        </div>
      )}

      {open && confirmingDone && (
        <div className="absolute left-0 top-full mt-1 w-52 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50 p-3">
          <p className="text-xs text-th-muted mb-2.5">Complete this conversation?</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => { setConfirmingDone(false); setOpen(false); }}
              className="flex-1 px-2.5 py-1 text-xs text-th-muted hover:text-th-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { onMarkDone(); setConfirmingDone(false); setOpen(false); }}
              disabled={archiving}
              className="flex-1 px-2.5 py-1 text-xs font-medium bg-st-red text-st-red-strong border border-st-red rounded-lg hover:bg-st-red-hover transition-colors disabled:opacity-50"
            >
              {archiving ? "..." : "Complete"}
            </button>
          </div>
        </div>
      )}

      {open && renaming && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50 p-2">
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") { setRenaming(false); setOpen(false); }
            }}
            className="w-full px-2.5 py-1.5 bg-th-subtle border border-th rounded-lg text-sm text-th-primary focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent"
          />
          <div className="flex justify-end gap-1.5 mt-2">
            <button
              onClick={() => { setRenaming(false); setOpen(false); }}
              className="px-2.5 py-1 text-xs text-th-muted hover:text-th-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRenameSubmit}
              className="px-2.5 py-1 text-xs font-medium bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConversationHeader({
  workItem,
  isClaudeActive,
  autoScroll,
  setAutoScroll,
  activeClaudeStatus,
  archiving,
  handleArchive,
  handleRename,
  branchControls,
  isArchived,
}: ConversationHeaderProps) {
  const {
    pushBranch,
    createPR,
    updatePR,
    pushing,
    creatingPR,
    updatingPR,
    prResult,
    worktreeGitStatus,
    prUrl,
    branchError,
  } = branchControls;

  const hasUnpushed = worktreeGitStatus ? (worktreeGitStatus.unpushed_count > 0 || worktreeGitStatus.uncommitted_count > 0) : false;
  const hasPR = !!prResult;
  const hasBranch = !!workItem.branch_name;
  const hasRemote = !!worktreeGitStatus?.has_remote;

  return (
    <div className="h-10 border-b border-th flex-shrink-0 relative z-10">
      <div className="h-full px-4 flex items-center gap-2">
        {/* Workspace setup indicator */}
        {workItem.worktree_status === "preparing" && (
          <span className="flex items-center gap-1.5 text-meta text-st-amber font-medium px-1.5">
            <SpinnerGap size={12} className="animate-spin" />
            Setting up workspace...
          </span>
        )}

        {/* Work context: title + status */}
        {workItem.worktree_status !== "preparing" && (
          <>
            {/* Title with dropdown */}
            <TitleDropdown
              title={workItem.title}
              onMarkDone={handleArchive}
              archiving={archiving}
              onRename={handleRename}
              isArchived={!!isArchived}
            />

            {/* Status pill */}
            <span className={`text-meta font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
              workItem.status === "in_progress"
                ? "bg-st-green text-st-green border border-st-green"
                : "bg-th-muted text-th-dimmed"
            }`}>
              {workItem.status === "in_progress" ? "In Progress" : "Done"}
            </span>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Git actions dropdown */}
        {!isArchived && hasBranch && (
          <GitActionsDropdown
            pushBranch={pushBranch}
            createPR={createPR}
            updatePR={updatePR}
            pushing={pushing}
            creatingPR={creatingPR}
            updatingPR={updatingPR}
            hasUnpushed={hasUnpushed}
            hasPR={hasPR}
            hasRemote={hasRemote}
            prUrl={prUrl}
            prResult={prResult}
            branchName={workItem.branch_name}
          />
        )}

        {/* LIVE indicator */}
        {isClaudeActive && (
          <span className="flex items-center gap-1.5 text-meta text-st-green font-medium px-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
            </span>
            LIVE
          </span>
        )}

        {/* Auto-scroll toggle */}
        {isClaudeActive && (
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1 rounded transition-colors ${
              autoScroll ? "text-st-green" : "text-th-muted"
            }`}
            title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
            aria-label={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
            aria-pressed={autoScroll}
          >
            <ArrowDown size={14} weight="bold" />
          </button>
        )}
      </div>

      {/* Errors */}
      {branchError && (
        <div className="px-4 pb-2">
          <div className="bg-st-red border border-st-red text-st-red px-3 py-1.5 rounded-lg text-xs">
            {branchError}
          </div>
        </div>
      )}
    </div>
  );
}
