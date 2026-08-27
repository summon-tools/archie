"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  Clock,
  GitPullRequest,
  MagnifyingGlass,
  SpinnerGap,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import Header from "@/components/Header";
import { getReviewsOverview, rerunPullRequestReview } from "@/lib/api";
import type { ReviewHistoryGroup, ReviewRunStatus, ReviewRunSummary, ReviewsOverviewResponse } from "@/lib/types";

const PAGE_SIZE = 20;

function parseTimestamp(value: string): number {
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = parseTimestamp(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatRelative(value: string): string {
  const parsed = parseTimestamp(value);
  if (!Number.isFinite(parsed)) return value;
  const seconds = Math.round((parsed - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function formatElapsed(review: ReviewRunSummary): string {
  const start = parseTimestamp(review.created_at);
  const end = review.completed_at ? parseTimestamp(review.completed_at) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function statusLabel(status: ReviewRunStatus): string {
  switch (status) {
    case "queued": return "Waiting";
    case "running": return "In progress";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "not_supported": return "Skipped";
  }
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "queued": return "Waiting for Archie";
    case "starting": return "Starting review";
    case "worktree_ready": return "Running local checks";
    case "context_ready": return "Analyzing changes";
    case "checks_completed": return "Checks completed";
    case "review_published": return "Review published";
    case "failed": return "Review failed";
    case "not_supported": return "Review not supported";
    default: return phase.replaceAll("_", " ");
  }
}

function statusClasses(status: ReviewRunStatus): string {
  switch (status) {
    case "queued": return "border-st-yellow bg-st-yellow text-st-yellow";
    case "running": return "border-st-blue bg-st-blue text-st-blue";
    case "completed": return "border-st-green bg-st-green text-st-green";
    case "failed": return "border-st-red bg-st-red text-st-red";
    case "not_supported": return "border-th bg-th-subtle text-th-muted";
  }
}

function StatusIcon({ status, size = 15 }: { status: ReviewRunStatus; size?: number }) {
  if (status === "running") return <SpinnerGap size={size} className="animate-spin" />;
  if (status === "queued") return <Clock size={size} />;
  if (status === "completed") return <CheckCircle size={size} weight="bold" />;
  if (status === "failed") return <XCircle size={size} weight="bold" />;
  return <WarningCircle size={size} />;
}

function StatusBadge({ review }: { review: ReviewRunSummary }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium ${statusClasses(review.status)}`}>
      <StatusIcon status={review.status} size={13} />
      {statusLabel(review.status)}
    </span>
  );
}

function PullRequestLink({ review, reviewResult = false }: { review: ReviewRunSummary; reviewResult?: boolean }) {
  const href = reviewResult ? review.github_review_url : review.pr_url;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-th-muted hover:text-th-primary transition-colors"
    >
      {reviewResult ? "View review" : "Open PR"}
      <ArrowSquareOut size={12} />
    </a>
  );
}

function ActiveReviewCard({ review }: { review: ReviewRunSummary }) {
  return (
    <article className="rounded-xl border border-th bg-th-surface p-4" aria-label={`${review.app_name} pull request ${review.pr_number}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge review={review} />
            <span className="text-xs font-medium text-th-secondary">{phaseLabel(review.phase)}</span>
            <span className="text-xs text-th-dimmed">{review.review_mode === "full" ? "Full review" : "Targeted review"}</span>
          </div>
          <div className="mt-3 flex items-start gap-2">
            <GitPullRequest size={18} weight="bold" className="mt-0.5 flex-shrink-0 text-th-muted" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-th-primary">
                {review.pr_title || `${review.owner}/${review.repo} #${review.pr_number}`}
              </h3>
              <p className="mt-1 text-xs text-th-muted">
                {review.app_name} · {review.owner}/{review.repo} #{review.pr_number}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-start">
          <div className="text-xs text-th-muted">
            {review.status === "queued" ? "Requested" : "Running"} {formatRelative(review.created_at)} · {formatElapsed(review)}
          </div>
          <PullRequestLink review={review} />
        </div>
      </div>
    </article>
  );
}

function HistoryRun({
  review,
  isAdmin,
  rerunning,
  canRerun,
  onRerun,
}: {
  review: ReviewRunSummary;
  isAdmin: boolean;
  rerunning: string | null;
  canRerun: boolean;
  onRerun: (review: ReviewRunSummary, mode: "targeted" | "full") => void;
}) {
  return (
    <div className="border-t border-th px-4 py-3 first:border-t-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <StatusBadge review={review} />
          <span className="font-medium text-th-secondary">{review.review_mode === "full" ? "Full review" : "Targeted review"}</span>
          <span className="text-th-muted">{review.findings_count} finding{review.findings_count === 1 ? "" : "s"}</span>
          {(review.model_id || review.provider_id) && (
            <span className="text-th-dimmed">{review.model_id || review.provider_id}</span>
          )}
          <span className="text-th-dimmed">{formatDate(review.completed_at || review.updated_at)} · {formatElapsed(review)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PullRequestLink review={review} reviewResult />
          {isAdmin && canRerun && (
            <>
              <button
                onClick={() => onRerun(review, "targeted")}
                disabled={rerunning !== null}
                className="inline-flex items-center gap-1 rounded-lg bg-btn-secondary px-2.5 py-1.5 text-xs font-medium text-btn-secondary hover:bg-btn-secondary-hover disabled:opacity-50"
              >
                {rerunning === `${review.id}:targeted` && <SpinnerGap size={12} className="animate-spin" />}
                Rerun targeted
              </button>
              <button
                onClick={() => onRerun(review, "full")}
                disabled={rerunning !== null}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-th-muted hover:bg-th-subtle hover:text-th-primary disabled:opacity-50"
              >
                {rerunning === `${review.id}:full` ? "Starting..." : "Rerun full"}
              </button>
            </>
          )}
        </div>
      </div>
      {review.failure_message && <p className="mt-2 text-xs text-st-red">{review.failure_message}</p>}
    </div>
  );
}

function HistoryGroupCard({
  group,
  expanded,
  isAdmin,
  rerunning,
  hasActiveReview,
  onToggle,
  onRerun,
}: {
  group: ReviewHistoryGroup;
  expanded: boolean;
  isAdmin: boolean;
  rerunning: string | null;
  hasActiveReview: boolean;
  onToggle: () => void;
  onRerun: (review: ReviewRunSummary, mode: "targeted" | "full") => void;
}) {
  const review = group.latest;
  return (
    <article className="overflow-hidden rounded-xl border border-th bg-th-surface">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-expanded={expanded}>
          <span className="mt-0.5 text-th-muted">{expanded ? <CaretDown size={16} /> : <CaretRight size={16} />}</span>
          <GitPullRequest size={18} weight="bold" className="mt-0.5 flex-shrink-0 text-th-muted" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-th-primary">
              {review.pr_title || `${review.owner}/${review.repo} #${review.pr_number}`}
            </span>
            <span className="mt-1 block text-xs text-th-muted">
              {review.app_name} · {review.owner}/{review.repo} #{review.pr_number} · {group.run_count} review run{group.run_count === 1 ? "" : "s"}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-3 pl-7 md:justify-end md:pl-0">
          <StatusBadge review={review} />
          <span className="text-xs text-th-muted">{review.findings_count} finding{review.findings_count === 1 ? "" : "s"}</span>
          <span className="text-xs text-th-dimmed">{formatRelative(review.completed_at || review.updated_at)}</span>
          <PullRequestLink review={review} />
        </div>
      </div>
      {expanded && (
        <div className="border-t border-th bg-th-elevated">
          {group.runs.map((run, index) => (
            <HistoryRun
              key={run.id}
              review={run}
              isAdmin={isAdmin}
              rerunning={rerunning}
              canRerun={index === 0 && !hasActiveReview}
              onRerun={onRerun}
            />
          ))}
        </div>
      )}
    </article>
  );
}

export default function ReviewsPageClient({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<ReviewsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appId, setAppId] = useState<number | undefined>();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rerunning, setRerunning] = useState<string | null>(null);
  const requestSerial = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadReviews = useCallback(async (quiet = false) => {
    const serial = ++requestSerial.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const next = await getReviewsOverview({ app_id: appId, search, page, page_size: PAGE_SIZE });
      if (serial !== requestSerial.current) return;
      setData(next);
      setError(null);
    } catch (loadError) {
      if (serial !== requestSerial.current) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load reviews");
    } finally {
      if (serial === requestSerial.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [appId, page, search]);

  useEffect(() => { loadReviews(false); }, [loadReviews]);

  useEffect(() => {
    if (!data?.active.length) return;
    const timer = window.setInterval(() => loadReviews(true), 5000);
    return () => window.clearInterval(timer);
  }, [data?.active.length, loadReviews]);

  const toggleGroup = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRerun = async (review: ReviewRunSummary, mode: "targeted" | "full") => {
    const key = `${review.id}:${mode}`;
    setRerunning(key);
    try {
      await rerunPullRequestReview(review.id, mode);
      await loadReviews(true);
    } catch (rerunError) {
      setError(rerunError instanceof Error ? rerunError.message : "Failed to rerun review");
    } finally {
      setRerunning(null);
    }
  };

  const activeCount = (data?.counts.queued || 0) + (data?.counts.running || 0);
  const activePullRequests = new Set((data?.active || []).map((review) => (
    `${review.app_id}:${review.owner.toLowerCase()}/${review.repo.toLowerCase()}#${review.pr_number}`
  )));

  return (
    <div className="min-h-screen bg-th-surface">
      <Header />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-th-primary">Reviews</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-th-muted">
              See what Archie is reviewing now and revisit pull-request reviews across every project.
            </p>
          </div>
          <button
            onClick={() => loadReviews(true)}
            disabled={refreshing}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-btn-secondary px-3 text-sm font-medium text-btn-secondary hover:bg-btn-secondary-hover disabled:opacity-50"
          >
            <ArrowsClockwise size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Review status summary">
          {[
            { label: "Active", value: activeCount, detail: `${data?.counts.running || 0} running, ${data?.counts.queued || 0} waiting` },
            { label: "Completed", value: data?.counts.completed || 0, detail: "Published review runs" },
            { label: "Failed", value: data?.counts.failed || 0, detail: `${data?.counts.not_supported || 0} skipped` },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-th bg-th-surface p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-th-muted">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold text-th-primary">{loading && !data ? "—" : item.value}</div>
              <div className="mt-1 text-xs text-th-dimmed">{item.detail}</div>
            </div>
          ))}
        </section>

        <section className="mt-6 flex flex-col gap-3 rounded-xl border border-th bg-th-surface p-4 sm:flex-row" aria-label="Review filters">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search reviews</span>
            <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-th-muted" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search project, repository, PR title or number"
              className="h-9 w-full rounded-lg border border-th bg-th-elevated pl-9 pr-3 text-sm text-th-primary outline-none placeholder:text-th-dimmed focus:border-th-strong"
            />
          </label>
          <label>
            <span className="sr-only">Filter by project</span>
            <select
              value={appId || "all"}
              onChange={(event) => {
                setAppId(event.target.value === "all" ? undefined : Number(event.target.value));
                setPage(1);
              }}
              className="h-9 min-w-48 rounded-lg border border-th bg-th-elevated px-3 text-sm text-th-primary outline-none focus:border-th-strong"
            >
              <option value="all">All projects</option>
              {(data?.projects || []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </section>

        {error && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-st-red bg-st-red p-4 text-sm text-st-red">
            <WarningCircle size={18} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="mt-10 flex items-center gap-2 text-sm text-th-muted"><SpinnerGap size={17} className="animate-spin" /> Loading reviews...</div>
        ) : (
          <>
            <section className="mt-8" aria-labelledby="active-reviews-heading">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="active-reviews-heading" className="text-base font-semibold text-th-primary">Active</h2>
                  <p className="mt-1 text-xs text-th-muted">Updates automatically while Archie is working.</p>
                </div>
                {activeCount > 0 && <span className="rounded-full bg-st-blue px-2.5 py-1 text-xs font-semibold text-st-blue">{activeCount}</span>}
              </div>
              <div className="mt-3 space-y-3" aria-live="polite">
                {data?.active.length ? data.active.map((review) => <ActiveReviewCard key={review.id} review={review} />) : (
                  <div className="rounded-xl border border-dashed border-th p-8 text-center">
                    <CheckCircle size={24} weight="bold" className="mx-auto text-th-dimmed" />
                    <p className="mt-3 text-sm font-medium text-th-secondary">No active reviews</p>
                    <p className="mt-1 text-xs text-th-muted">New GitHub review requests will appear here as soon as they are queued.</p>
                  </div>
                )}
              </div>
            </section>

            <section className="mt-10" aria-labelledby="review-history-heading">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 id="review-history-heading" className="text-base font-semibold text-th-primary">History</h2>
                  <p className="mt-1 text-xs text-th-muted">Grouped by pull request. Expand a PR to see each review run.</p>
                </div>
                <span className="text-xs text-th-dimmed">{data?.pagination.total_groups || 0} pull request{data?.pagination.total_groups === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-3 space-y-3">
                {data?.history.length ? data.history.map((group) => (
                  <HistoryGroupCard
                    key={group.key}
                    group={group}
                    expanded={expanded.has(group.key)}
                    isAdmin={isAdmin}
                    rerunning={rerunning}
                    hasActiveReview={activePullRequests.has(group.key)}
                    onToggle={() => toggleGroup(group.key)}
                    onRerun={handleRerun}
                  />
                )) : (
                  <div className="rounded-xl border border-dashed border-th p-8 text-center">
                    <GitPullRequest size={24} className="mx-auto text-th-dimmed" />
                    <p className="mt-3 text-sm font-medium text-th-secondary">No past reviews found</p>
                    <p className="mt-1 text-xs text-th-muted">Try another project or search, or request a review from GitHub.</p>
                  </div>
                )}
              </div>

              {data && data.pagination.page_count > 1 && (
                <div className="mt-5 flex items-center justify-between gap-3">
                  <button
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={!data.pagination.has_previous}
                    className="rounded-lg bg-btn-secondary px-3 py-1.5 text-xs font-medium text-btn-secondary hover:bg-btn-secondary-hover disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-th-muted">Page {data.pagination.page} of {data.pagination.page_count}</span>
                  <button
                    onClick={() => setPage((current) => current + 1)}
                    disabled={!data.pagination.has_next}
                    className="rounded-lg bg-btn-secondary px-3 py-1.5 text-xs font-medium text-btn-secondary hover:bg-btn-secondary-hover disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
