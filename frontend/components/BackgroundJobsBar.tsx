"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { SpinnerGap } from "@phosphor-icons/react";
import { getActiveJobs, type ActiveJob } from "@/lib/api";

interface BackgroundJobsBarProps {
  collapsed: boolean;
  appId?: number;
  onNotificationCountChange?: (count: number) => void;
}

const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 10000;

export default function BackgroundJobsBar({ collapsed, appId, onNotificationCountChange }: BackgroundJobsBarProps) {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [expanded, setExpanded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const hasJobsRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const data = await getActiveJobs(appId);
      if (!mountedRef.current) return;
      setJobs(data.jobs);
      hasJobsRef.current = data.jobs.length > 0;
      onNotificationCountChange?.(data.notification_unread_count ?? 0);
    } catch {
      // Silently ignore polling errors
    }
  }, [appId, onNotificationCountChange]);

  useEffect(() => {
    mountedRef.current = true;

    // Immediate first fetch
    poll();

    const schedule = () => {
      timerRef.current = setTimeout(async () => {
        await poll();
        if (mountedRef.current) schedule();
      }, hasJobsRef.current ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    };
    schedule();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll]);

  if (jobs.length === 0) return null;

  const primary = jobs[0];
  const extraCount = jobs.length - 1;

  // ── Collapsed sidebar: icon only ──────────────────────────────
  if (collapsed) {
    return (
      <div
        className="relative flex items-center justify-center p-1.5"
        title={primary.label}
      >
        <SpinnerGap size={16} weight="bold" className="animate-spin text-brand-400" />
        {extraCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[8px] font-bold bg-brand-500 text-white rounded-full flex items-center justify-center">
            {extraCount + 1}
          </span>
        )}
      </div>
    );
  }

  // ── Expanded sidebar ──────────────────────────────────────────
  return (
    <div className="relative">
      <button
        onClick={() => extraCount > 0 && setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-th-secondary hover:bg-th-subtle transition-colors"
      >
        <SpinnerGap size={13} weight="bold" className="animate-spin text-brand-400 flex-shrink-0" />
        <span className="truncate">{primary.label}</span>
        {extraCount > 0 && (
          <span className="ml-auto text-meta font-medium bg-brand-500/20 text-brand-400 px-1.5 py-0.5 rounded-full flex-shrink-0">
            +{extraCount}
          </span>
        )}
      </button>

      {/* Expanded job list */}
      {expanded && extraCount > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {jobs.slice(1).map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-2 px-2 py-1 rounded-lg text-xs text-th-dimmed"
            >
              <SpinnerGap size={11} weight="bold" className="animate-spin text-brand-400/60 flex-shrink-0" />
              <span className="truncate">{job.label}</span>
              <span className="ml-auto text-meta text-th-dimmed truncate max-w-[80px]">{job.app_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
