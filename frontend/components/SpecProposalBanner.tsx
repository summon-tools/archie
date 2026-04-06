"use client";

import { useState } from "react";
import { Check, X, CaretDown, CaretRight, ArrowsClockwise } from "@phosphor-icons/react";
import { reviewSpecProposal } from "@/lib/api";

interface Proposal {
  id: string;
  action: string;
  path: string;
  content: string;
  old_content?: string;
  created_at: string;
}

interface SpecProposalBannerProps {
  appId: number;
  proposals: Proposal[];
  onUpdate: () => void;
  fullHeight?: boolean;
}

function ProposalItem({
  proposal,
  appId,
  onUpdate,
}: {
  proposal: Proposal;
  appId: number;
  onUpdate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(false);

  const handleAction = async (action: "accept" | "reject") => {
    setActing(true);
    try {
      await reviewSpecProposal(appId, proposal.id, action);
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
        <span
          className={`text-meta font-medium uppercase px-1.5 py-0.5 rounded ${
            proposal.action === "create"
              ? "bg-st-green text-st-green"
              : "bg-st-blue text-st-blue"
          }`}
        >
          {proposal.action}
        </span>
        <span className="text-xs font-mono text-th-primary flex-1 truncate">
          {proposal.path}
        </span>
        <button
          onClick={() => handleAction("accept")}
          disabled={acting}
          className="p-2 text-st-green hover:bg-st-green rounded transition-colors disabled:opacity-50"
          title="Accept"
        >
          <Check size={14} weight="bold" />
        </button>
        <button
          onClick={() => handleAction("reject")}
          disabled={acting}
          className="p-2 text-st-red hover:bg-st-red rounded transition-colors disabled:opacity-50"
          title="Reject"
        >
          <X size={14} weight="bold" />
        </button>
      </div>
      {expanded && (
        <div className="p-3 bg-th-code overflow-x-auto">
          <pre className="text-meta font-mono leading-relaxed text-th-secondary whitespace-pre-wrap">
            {proposal.content.slice(0, 2000)}
            {proposal.content.length > 2000 && "\n..."}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function SpecProposalBanner({
  appId,
  proposals,
  onUpdate,
  fullHeight = false,
}: SpecProposalBannerProps) {
  const [actingAll, setActingAll] = useState(false);

  if (proposals.length === 0) return null;

  const handleAll = async (action: "accept_all" | "reject_all") => {
    setActingAll(true);
    try {
      await reviewSpecProposal(appId, null, action);
      onUpdate();
    } finally {
      setActingAll(false);
    }
  };

  return (
    <div className={fullHeight ? "flex flex-col h-full" : "border-b border-th"}>
      <div className="px-4 py-2 bg-brand-500/5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <ArrowsClockwise size={14} className="text-brand-400" />
          <span className="text-xs font-medium text-th-primary">
            {proposals.length} spec update{proposals.length !== 1 ? "s" : ""} pending review
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleAll("accept_all")}
            disabled={actingAll}
            className="text-meta px-2 py-0.5 bg-st-green text-st-green rounded hover:bg-st-green-hover font-medium disabled:opacity-50 transition-colors"
          >
            Accept All
          </button>
          <button
            onClick={() => handleAll("reject_all")}
            disabled={actingAll}
            className="text-meta px-2 py-0.5 bg-st-red text-st-red rounded hover:bg-st-red-hover font-medium disabled:opacity-50 transition-colors"
          >
            Reject All
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
