"use client";

import { useState } from "react";
import { Check, X, CaretDown, CaretRight, ListPlus } from "@phosphor-icons/react";
import { reviewSpecTaskProposal } from "@/lib/api";

interface TaskProposal {
  id: string;
  title: string;
  description: string;
  spec_path: string;
  created_at: string;
}

interface WorkItemProposalBannerProps {
  appId: number;
  proposals: TaskProposal[];
  onUpdate: () => void;
  fullHeight?: boolean;
}

function ProposalItem({
  proposal,
  appId,
  onUpdate,
}: {
  proposal: TaskProposal;
  appId: number;
  onUpdate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(false);

  const handleAction = async (action: "accept" | "reject") => {
    setActing(true);
    try {
      await reviewSpecTaskProposal(appId, proposal.id, action);
      onUpdate();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="border border-th rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-overlay-light">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-th-dimmed hover:text-th-secondary"
        >
          {expanded ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
        </button>
        <span className="text-xs text-th-primary flex-1 truncate font-medium">
          {proposal.title}
        </span>
        <span className="text-meta text-th-dimmed font-mono flex-shrink-0">
          {proposal.spec_path}
        </span>
        <button
          onClick={() => handleAction("accept")}
          disabled={acting}
          className="p-2 text-st-green hover:bg-st-green rounded transition-colors disabled:opacity-50"
          title="Create task"
        >
          <Check size={14} weight="bold" />
        </button>
        <button
          onClick={() => handleAction("reject")}
          disabled={acting}
          className="p-2 text-st-red hover:bg-st-red rounded transition-colors disabled:opacity-50"
          title="Dismiss"
        >
          <X size={14} weight="bold" />
        </button>
      </div>
      {expanded && proposal.description && (
        <div className="px-3 py-2 bg-th-code border-t border-th">
          <p className="text-meta text-th-secondary leading-relaxed whitespace-pre-wrap">
            {proposal.description}
          </p>
        </div>
      )}
    </div>
  );
}

export default function WorkItemProposalBanner({
  appId,
  proposals,
  onUpdate,
  fullHeight = false,
}: WorkItemProposalBannerProps) {
  const [actingAll, setActingAll] = useState(false);

  if (proposals.length === 0) return null;

  const handleAll = async (action: "accept_all" | "reject_all") => {
    setActingAll(true);
    try {
      await reviewSpecTaskProposal(appId, null, action);
      onUpdate();
    } finally {
      setActingAll(false);
    }
  };

  return (
    <div className={fullHeight ? "flex flex-col h-full" : "border-b border-th"}>
      <div className="px-4 py-2 bg-st-amber flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <ListPlus size={14} className="text-st-amber" />
          <span className="text-xs font-medium text-th-primary">
            {proposals.length} task{proposals.length !== 1 ? "s" : ""} suggested from spec changes
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleAll("accept_all")}
            disabled={actingAll}
            className="text-meta px-2 py-0.5 bg-st-green text-st-green rounded hover:bg-st-green-hover font-medium disabled:opacity-50 transition-colors"
          >
            Create All
          </button>
          <button
            onClick={() => handleAll("reject_all")}
            disabled={actingAll}
            className="text-meta px-2 py-0.5 bg-st-red text-st-red rounded hover:bg-st-red-hover font-medium disabled:opacity-50 transition-colors"
          >
            Dismiss All
          </button>
        </div>
      </div>
      <div className={`px-4 py-2 space-y-1.5 overflow-y-auto ${fullHeight ? "flex-1" : "max-h-64"}`}>
        {proposals.map((p) => (
          <ProposalItem key={p.id} proposal={p} appId={appId} onUpdate={onUpdate} />
        ))}
      </div>
    </div>
  );
}
