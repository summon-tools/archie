"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import Header from "@/components/Header";
import { detectOutcomeFollowups, getLatestOutcomeLearningReport, getOutcomeJob, getOutcomesSettings, getOutcomesSummary, recomputeOutcomeSnapshots, runOutcomeLearningReport, runOutcomesEvidenceAssessment, syncOutcomesGitHubEvidence, updateOutcomesSettings } from "@/lib/api";
import type { OutcomeAttributionClassification, OutcomeFollowupRelation, OutcomeJob, OutcomeLearningReportExample, OutcomeLearningReportInsight, OutcomeLearningReportRun, OutcomeQualityBand, OutcomeRow, OutcomeRowGroup, OutcomeRowsPagination, OutcomesGitHubSyncSettings, OutcomesSummaryResponse, OutcomeState } from "@/lib/types";

const OUTCOME_ORDER: OutcomeState[] = ["pending_pr", "merged", "closed_unmerged", "no_pr", "unknown"];
const PAGE_SIZE_OPTIONS = ["25", "50", "100", "200"];

function initialGroupPages(): Record<OutcomeState, number> {
  return OUTCOME_ORDER.reduce((acc, state) => {
    acc[state] = 1;
    return acc;
  }, {} as Record<OutcomeState, number>);
}

function formatCurrency(value: number): string {
  const maximumFractionDigits = value > 0 && value < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
}

function formatDate(value: string): string {
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function outcomeLabel(state: OutcomeState): string {
  switch (state) {
    case "pending_pr": return "Pending PR";
    case "merged": return "Merged";
    case "closed_unmerged": return "Closed unmerged";
    case "no_pr": return "No PR";
    case "unknown": return "Unknown";
  }
}

function outcomeClass(state: OutcomeState): string {
  switch (state) {
    case "pending_pr": return "bg-st-blue text-st-blue border-st-blue";
    case "merged": return "bg-st-green text-st-green border-st-green";
    case "closed_unmerged": return "bg-st-red text-st-red border-st-red";
    case "no_pr": return "bg-th-muted text-th-secondary border-th";
    case "unknown": return "bg-st-yellow text-st-yellow border-st-yellow";
  }
}

function qualityLabel(band: OutcomeQualityBand | null): string {
  switch (band) {
    case "pending": return "Pending";
    case "strong": return "Strong";
    case "useful": return "Useful";
    case "costly_reworked": return "Costly rework";
    case "abandoned": return "Abandoned";
    case "unknown": return "Unknown";
    default: return "Not computed";
  }
}

function qualityClass(band: OutcomeQualityBand | null): string {
  switch (band) {
    case "strong": return "bg-st-green text-st-green border-st-green";
    case "useful": return "bg-st-blue text-st-blue border-st-blue";
    case "costly_reworked": return "bg-st-yellow text-st-yellow border-st-yellow";
    case "abandoned": return "bg-st-red text-st-red border-st-red";
    case "pending": return "bg-th-muted text-th-secondary border-th";
    case "unknown": return "bg-th-muted text-th-secondary border-th";
    default: return "bg-th-subtle text-th-muted border-th";
  }
}

function attributionLabel(value: OutcomeAttributionClassification | null): string {
  switch (value) {
    case "agent": return "Agent";
    case "known_user": return "Known user";
    case "human": return "Human";
    case "unknown": return "Unknown";
    default: return "Not computed";
  }
}

function commitClassificationLabel(value: string): string {
  switch (value) {
    case "agent_authored": return "Agent authored";
    case "agent_coauthored": return "Agent coauthored";
    case "human_authored": return "Human authored";
    default: return "Unknown";
  }
}

function followupTypeLabel(value: string): string {
  switch (value) {
    case "none": return "None";
    case "clarification": return "Clarification";
    case "expected_iteration": return "Expected iteration";
    case "agent_correction": return "Agent correction";
    case "unrelated_extension": return "Unrelated extension";
    default: return "Unknown";
  }
}

function followupRelationLabel(value: OutcomeFollowupRelation | string): string {
  switch (value) {
    case "expected_iteration": return "Expected iteration";
    case "routine_followup": return "Routine follow-up";
    case "agent_correction": return "Agent correction";
    case "regression_fix": return "Regression fix";
    case "revert": return "Revert";
    case "no_relation": return "No relation";
    default: return "Unknown";
  }
}

function isJobActive(job: OutcomeJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

function jobButtonLabel(job: OutcomeJob | null, idle: string, active: string): string {
  if (!job || job.status === "completed" || job.status === "failed") return idle;
  return job.status === "queued" ? "Queued..." : active;
}

function jobResult(job: OutcomeJob): any {
  return job.result && typeof job.result === "object" ? job.result as any : {};
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border border-th bg-th-surface rounded-xl p-4 min-h-[116px]">
      <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-th-primary">{value}</div>
      <div className="mt-2 text-xs leading-relaxed text-th-muted">{detail}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-th rounded-xl bg-th-surface p-8 text-center">
      <h2 className="text-base font-semibold text-th-primary">No LLM outcome data yet</h2>
      <p className="mt-2 text-sm text-th-muted">
        Outcomes appear after Archie has work items, runs, and pull request artifacts to summarize.
      </p>
      <Link
        href="/"
        className="inline-flex mt-5 px-3 py-1.5 rounded-lg bg-btn-secondary text-btn-secondary text-sm font-medium hover:bg-btn-secondary-hover transition-colors"
      >
        Back to projects
      </Link>
    </div>
  );
}

export default function OutcomesPage() {
  const [data, setData] = useState<OutcomesSummaryResponse | null>(null);
  const [settings, setSettings] = useState<OutcomesGitHubSyncSettings | null>(null);
  const [latestReport, setLatestReport] = useState<OutcomeLearningReportRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncJob, setSyncJob] = useState<OutcomeJob | null>(null);
  const [snapshotJob, setSnapshotJob] = useState<OutcomeJob | null>(null);
  const [assessmentJob, setAssessmentJob] = useState<OutcomeJob | null>(null);
  const [reportJob, setReportJob] = useState<OutcomeJob | null>(null);
  const [followupJob, setFollowupJob] = useState<OutcomeJob | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [assessmentMessage, setAssessmentMessage] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [followupMessage, setFollowupMessage] = useState<string | null>(null);
  const [syncRangeDays, setSyncRangeDays] = useState("14");
  const [snapshotRangeDays, setSnapshotRangeDays] = useState("14");
  const [reportRangeDays, setReportRangeDays] = useState("30");
  const [followupRangeDays, setFollowupRangeDays] = useState("90");
  const [appFilter, setAppFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [runStatusFilter, setRunStatusFilter] = useState("all");
  const [prStateFilter, setPrStateFilter] = useState("all");
  const [groupPages, setGroupPages] = useState<Record<OutcomeState, number>>(() => initialGroupPages());
  const [pageSize, setPageSize] = useState("25");
  const initializedSettingsRef = useRef(false);
  const syncing = isJobActive(syncJob);
  const recomputing = isJobActive(snapshotJob);
  const assessing = isJobActive(assessmentJob);
  const generatingReport = isJobActive(reportJob);
  const detectingFollowups = isJobActive(followupJob);

  const summaryQuery = useMemo(() => ({
    page_size: Number(pageSize),
    pending_pr_page: groupPages.pending_pr,
    merged_page: groupPages.merged,
    closed_unmerged_page: groupPages.closed_unmerged,
    no_pr_page: groupPages.no_pr,
    unknown_page: groupPages.unknown,
    app_id: appFilter,
    outcome_state: outcomeFilter,
    provider: providerFilter,
    model: modelFilter,
    run_status: runStatusFilter,
    pr_state: prStateFilter,
  }), [appFilter, groupPages.closed_unmerged, groupPages.merged, groupPages.no_pr, groupPages.pending_pr, groupPages.unknown, modelFilter, outcomeFilter, pageSize, prStateFilter, providerFilter, runStatusFilter]);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([getOutcomesSummary(summaryQuery), getOutcomesSettings(), getLatestOutcomeLearningReport()])
      .then(([summary, loadedSettings, reportResponse]) => {
        setData(summary);
        setSettings(loadedSettings);
        setLatestReport(reportResponse.report);
        if (!initializedSettingsRef.current) {
          setSyncRangeDays(String(loadedSettings.observation_window_days));
          setSnapshotRangeDays(String(loadedSettings.observation_window_days));
          initializedSettingsRef.current = true;
        }
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load outcomes"))
      .finally(() => setLoading(false));
  }, [summaryQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refreshDashboardData = useCallback(async () => {
    const [summary, reportResponse] = await Promise.all([
      getOutcomesSummary(summaryQuery),
      getLatestOutcomeLearningReport(),
    ]);
    setData(summary);
    setLatestReport(reportResponse.report);
  }, [summaryQuery]);

  const setJobForKind = useCallback((job: OutcomeJob) => {
    if (job.kind === "github_sync") setSyncJob(job);
    if (job.kind === "snapshot_recompute") setSnapshotJob(job);
    if (job.kind === "evidence_assessment") setAssessmentJob(job);
    if (job.kind === "learning_report") setReportJob(job);
    if (job.kind === "followup_detection") setFollowupJob(job);
  }, []);

  const setMessageForJob = useCallback((job: OutcomeJob) => {
    if (job.status === "failed") {
      const message = job.error_text || "Background job failed";
      if (job.kind === "github_sync") setSyncMessage(message);
      if (job.kind === "snapshot_recompute") setSnapshotMessage(message);
      if (job.kind === "evidence_assessment") setAssessmentMessage(message);
      if (job.kind === "learning_report") setReportMessage(message);
      if (job.kind === "followup_detection") setFollowupMessage(message);
      return;
    }
    if (job.status !== "completed") return;
    const result = jobResult(job);
    if (job.kind === "github_sync") {
      setSyncMessage(`Synced ${result.run?.synced_count ?? 0} of ${result.run?.scanned_count ?? 0} PRs${result.run?.failed_count ? `, ${result.run.failed_count} failed` : ""}. Recomputed ${result.recomputed_snapshots ?? 0} snapshots.`);
    }
    if (job.kind === "snapshot_recompute") {
      setSnapshotMessage(`Recomputed ${result.recomputed_count ?? 0} outcome snapshot${result.recomputed_count === 1 ? "" : "s"}.`);
    }
    if (job.kind === "evidence_assessment") {
      setAssessmentMessage(`Assessed ${result.assessed_count ?? 0} PR${result.assessed_count === 1 ? "" : "s"}, skipped ${result.skipped_count ?? 0}, failed ${result.failed_count ?? 0}. Recomputed ${result.recomputed_snapshots ?? 0} snapshot${result.recomputed_snapshots === 1 ? "" : "s"}.`);
    }
    if (job.kind === "learning_report") {
      const report = result.report?.report;
      setReportMessage(`Generated report with ${report?.counts?.resolved_prs ?? 0} resolved PR${report?.counts?.resolved_prs === 1 ? "" : "s"} and ${report?.insights?.length ?? 0} insight${report?.insights?.length === 1 ? "" : "s"}.`);
    }
    if (job.kind === "followup_detection") {
      setFollowupMessage(`Scanned ${result.scanned_source_prs ?? 0} merged PR${result.scanned_source_prs === 1 ? "" : "s"}, checked ${result.candidate_count ?? 0} candidate${result.candidate_count === 1 ? "" : "s"}, detected ${result.detected_count ?? 0} follow-up${result.detected_count === 1 ? "" : "s"} including ${result.regression_count ?? 0} likely fix${result.regression_count === 1 ? "" : "es"}.`);
    }
  }, []);

  useEffect(() => {
    const activeJobs = [syncJob, snapshotJob, assessmentJob, reportJob, followupJob].filter(isJobActive);
    if (activeJobs.length === 0) return;
    let cancelled = false;

    async function pollJobs() {
      const updates = await Promise.all(activeJobs.map(async (job) => {
        try {
          return (await getOutcomeJob(job!.id)).job;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      let shouldRefresh = false;
      for (const job of updates) {
        if (!job) continue;
        setJobForKind(job);
        if (job.status === "completed" || job.status === "failed") {
          setMessageForJob(job);
          shouldRefresh = true;
        }
      }
      if (shouldRefresh) {
        await refreshDashboardData().catch((err) => setError(err instanceof Error ? err.message : "Failed to refresh outcomes"));
      }
    }

    pollJobs();
    const timer = window.setInterval(() => {
      pollJobs();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [assessmentJob, followupJob, refreshDashboardData, reportJob, setJobForKind, setMessageForJob, snapshotJob, syncJob]);

  const syncedEvidenceRows = useMemo(() => {
    return data?.coverage.github_evidence_synced_rows || 0;
  }, [data?.coverage.github_evidence_synced_rows]);

  const computedSnapshotRows = useMemo(() => {
    return data?.coverage.computed_snapshot_rows || 0;
  }, [data?.coverage.computed_snapshot_rows]);

  const assessedEvidenceRows = useMemo(() => {
    return data?.coverage.assessed_evidence_rows || 0;
  }, [data?.coverage.assessed_evidence_rows]);

  const followupRows = useMemo(() => {
    return data?.coverage.followup_rows || 0;
  }, [data?.coverage.followup_rows]);

  const regressionFollowupRows = useMemo(() => {
    return data?.coverage.regression_followup_rows || 0;
  }, [data?.coverage.regression_followup_rows]);

  const qualityCounts = useMemo(() => {
    return data?.coverage.quality_counts || {};
  }, [data?.coverage.quality_counts]);

  function updatePagedFilter(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setGroupPages(initialGroupPages());
    };
  }

  function handlePageSizeChange(value: string) {
    setPageSize(value);
    setGroupPages(initialGroupPages());
  }

  async function handleRangeChange(value: string) {
    setSyncRangeDays(value);
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1) return;
    try {
      const updated = await updateOutcomesSettings({ observation_window_days: days });
      setSettings(updated);
      setSyncMessage(null);
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Failed to update sync window");
    }
  }

  async function handleSyncNow() {
    const days = Number(syncRangeDays);
    if (!Number.isInteger(days) || days < 1) return;
    setSyncMessage(null);
    try {
      const result = await syncOutcomesGitHubEvidence({ range_days: days });
      setSyncJob(result.job);
      setSyncMessage("Queued GitHub evidence sync. The dashboard will refresh when it finishes.");
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "GitHub evidence sync failed");
    }
  }

  async function handleRecomputeSnapshots() {
    const days = Number(snapshotRangeDays);
    if (!Number.isInteger(days) || days < 1) return;
    setSnapshotMessage(null);
    try {
      const result = await recomputeOutcomeSnapshots({ range_days: days });
      setSnapshotJob(result.job);
      setSnapshotMessage("Queued snapshot recompute. The dashboard will refresh when it finishes.");
    } catch (err) {
      setSnapshotMessage(err instanceof Error ? err.message : "Outcome snapshot recompute failed");
    }
  }

  async function handleAssessEvidence() {
    const days = Number(snapshotRangeDays);
    if (!Number.isInteger(days) || days < 1) return;
    setAssessmentMessage(null);
    try {
      const result = await runOutcomesEvidenceAssessment({ range_days: days });
      setAssessmentJob(result.job);
      setAssessmentMessage("Queued evidence assessment. The dashboard will refresh when it finishes.");
    } catch (err) {
      setAssessmentMessage(err instanceof Error ? err.message : "Outcome evidence assessment failed");
    }
  }

  async function handleRunReport() {
    const days = Number(reportRangeDays);
    if (!Number.isInteger(days) || days < 1) return;
    setReportMessage(null);
    try {
      const result = await runOutcomeLearningReport({ range_days: days });
      setReportJob(result.job);
      setReportMessage("Queued learning report generation. The report panel will refresh when it finishes.");
    } catch (err) {
      setReportMessage(err instanceof Error ? err.message : "Outcome learning report failed");
    }
  }

  async function handleDetectFollowups() {
    const days = Number(followupRangeDays);
    if (!Number.isInteger(days) || days < 1) return;
    setFollowupMessage(null);
    try {
      const result = await detectOutcomeFollowups({ range_days: days });
      setFollowupJob(result.job);
      setFollowupMessage("Queued follow-up detection. The dashboard will refresh when it finishes.");
    } catch (err) {
      setFollowupMessage(err instanceof Error ? err.message : "Follow-up detection failed");
    }
  }

  const groupedRows = useMemo<OutcomeRowGroup[]>(() => {
    if (!data) return [];
    const groups = data.row_groups?.length
      ? data.row_groups
      : OUTCOME_ORDER.map((state) => {
        const rows = (data.rows || []).filter((row) => row.outcome_state === state);
        return {
          state,
          rows,
          pagination: {
            page: 1,
            page_size: Number(pageSize),
            total_rows: rows.length,
            filtered_rows: rows.length,
            page_count: rows.length > 0 ? 1 : 0,
            has_previous: false,
            has_next: false,
          },
        };
      });
    return groups.filter((group) => group.pagination.filtered_rows > 0);
  }, [data, pageSize]);

  const visibleRowCount = useMemo(() => {
    return groupedRows.reduce((total, group) => total + group.rows.length, 0);
  }, [groupedRows]);

  const filteredRowCount = useMemo(() => {
    if (!data?.row_groups?.length) return data?.pagination.filtered_rows || 0;
    return data.row_groups.reduce((total, group) => total + group.pagination.filtered_rows, 0);
  }, [data?.pagination.filtered_rows, data?.row_groups]);

  const resetFilters = () => {
    setAppFilter("all");
    setOutcomeFilter("all");
    setProviderFilter("all");
    setModelFilter("all");
    setRunStatusFilter("all");
    setPrStateFilter("all");
    setGroupPages(initialGroupPages());
  };

  return (
    <div className="min-h-screen bg-th-surface">
      <Header />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-th-primary">LLM Outcomes</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-th-muted">
              Global visibility into Archie sessions, local PR linkage, and known LLM cost across all projects.
            </p>
          </div>
          {data && (
            <div className="text-xs text-th-dimmed">
              Generated {formatDate(data.generated_at)}
            </div>
          )}
        </div>

        {loading && (
          <div className="mt-8 text-sm text-th-muted">Loading outcomes...</div>
        )}

        {error && (
          <div className="mt-8 border border-st-red bg-st-red rounded-xl p-4 text-sm text-st-red">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {data.warnings.length > 0 && (
              <div className="mt-6 border border-st-yellow bg-st-yellow rounded-xl p-4">
                <div className="text-sm font-semibold text-st-yellow">Evidence warnings</div>
                <ul className="mt-2 space-y-1 text-sm text-th-secondary">
                  {data.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard
                label="Known LLM cost"
                value={formatCurrency(data.costs.total_known_cost_usd)}
                detail={`${data.counts.rows_with_unknown_cost} row${data.counts.rows_with_unknown_cost === 1 ? "" : "s"} still have incomplete cost evidence.`}
              />
              <StatCard
                label="Merged PR cost"
                value={formatCurrency(data.costs.merged_pr_cost_usd)}
                detail={`${data.counts.merged_prs} merged PR${data.counts.merged_prs === 1 ? "" : "s"} with refreshed evidence.`}
              />
              <StatCard
                label="Pending PR cost"
                value={formatCurrency(data.costs.pending_pr_cost_usd)}
                detail={`${data.counts.pending_prs} open or locally linked PR${data.counts.pending_prs === 1 ? "" : "s"} still in progress.`}
              />
              <StatCard
                label="No-PR cost"
                value={formatCurrency(data.costs.no_pr_cost_usd)}
                detail={`${data.counts.no_pr_work} work item${data.counts.no_pr_work === 1 ? "" : "s"} have no PR artifact.`}
              />
              <StatCard
                label="Unknown cost runs"
                value={String(data.counts.unknown_cost_runs)}
                detail="Runs with missing, null, or invalid cost values are counted instead of treated as free."
              />
            </section>

            <section className="mt-6 border border-th rounded-xl bg-th-surface p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-th-primary">GitHub evidence</h2>
                  <div className="mt-1 text-xs text-th-muted">
                    {syncedEvidenceRows} PR row{syncedEvidenceRows === 1 ? "" : "s"} synced. Daily sync {settings?.daily_sync_enabled ? "enabled" : "disabled"} at {settings?.daily_sync_hour_utc ?? 6}:00 UTC.
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <FilterSelect
                    label="Window"
                    value={syncRangeDays}
                    onChange={handleRangeChange}
                    includeAll={false}
                    options={[
                      { value: "14", label: "Last 14 days" },
                      { value: "30", label: "Last 30 days" },
                      { value: "60", label: "Last 60 days" },
                      { value: "90", label: "Last 90 days" },
                    ]}
                  />
                  <button
                    onClick={handleSyncNow}
                    disabled={syncing}
                    className="h-9 px-3 rounded-lg bg-btn-secondary text-btn-secondary text-sm font-medium hover:bg-btn-secondary-hover disabled:opacity-50 transition-colors"
                  >
                    {jobButtonLabel(syncJob, "Sync now", "Syncing...")}
                  </button>
                </div>
              </div>
              {syncMessage && (
                <div className="mt-3 text-xs text-th-muted">{syncMessage}</div>
              )}
            </section>

            <section className="mt-6 border border-th rounded-xl bg-th-surface p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-th-primary">Outcome snapshots</h2>
                  <div className="mt-1 text-xs text-th-muted">
                    {computedSnapshotRows} computed, {assessedEvidenceRows} LLM-assessed. Strong {qualityCounts.strong || 0}, useful {qualityCounts.useful || 0}, costly rework {qualityCounts.costly_reworked || 0}, pending {qualityCounts.pending || 0}.
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <FilterSelect
                    label="Window"
                    value={snapshotRangeDays}
                    onChange={setSnapshotRangeDays}
                    includeAll={false}
                    options={[
                      { value: "14", label: "Last 14 days" },
                      { value: "30", label: "Last 30 days" },
                      { value: "60", label: "Last 60 days" },
                      { value: "90", label: "Last 90 days" },
                    ]}
                  />
                  <button
                    onClick={handleRecomputeSnapshots}
                    disabled={recomputing || assessing}
                    className="h-9 px-3 rounded-lg bg-btn-secondary text-btn-secondary text-sm font-medium hover:bg-btn-secondary-hover disabled:opacity-50 transition-colors"
                  >
                    {jobButtonLabel(snapshotJob, "Recompute", "Computing...")}
                  </button>
                  <button
                    onClick={handleAssessEvidence}
                    disabled={assessing || recomputing}
                    className="h-9 px-3 rounded-lg bg-btn-secondary text-btn-secondary text-sm font-medium hover:bg-btn-secondary-hover disabled:opacity-50 transition-colors"
                  >
                    {jobButtonLabel(assessmentJob, "Assess evidence", "Assessing...")}
                  </button>
                </div>
              </div>
              {snapshotMessage && (
                <div className="mt-3 text-xs text-th-muted">{snapshotMessage}</div>
              )}
              {assessmentMessage && (
                <div className="mt-2 text-xs text-th-muted">{assessmentMessage}</div>
              )}
            </section>

            <section className="mt-6 border border-th rounded-xl bg-th-surface p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-th-primary">Post-merge follow-ups</h2>
                  <div className="mt-1 text-xs text-th-muted">
                    {followupRows} merged row{followupRows === 1 ? "" : "s"} have detected follow-ups; {regressionFollowupRows} have likely regression, revert, or agent-correction evidence.
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <FilterSelect
                    label="Source PRs"
                    value={followupRangeDays}
                    onChange={setFollowupRangeDays}
                    includeAll={false}
                    options={[
                      { value: "14", label: "Last 14 days" },
                      { value: "30", label: "Last 30 days" },
                      { value: "60", label: "Last 60 days" },
                      { value: "90", label: "Last 90 days" },
                    ]}
                  />
                  <button
                    onClick={handleDetectFollowups}
                    disabled={detectingFollowups}
                    className="h-9 px-3 rounded-lg bg-btn-secondary text-btn-secondary text-sm font-medium hover:bg-btn-secondary-hover disabled:opacity-50 transition-colors"
                  >
                    {jobButtonLabel(followupJob, "Detect follow-ups", "Detecting...")}
                  </button>
                </div>
              </div>
              {followupMessage && (
                <div className="mt-3 text-xs text-th-muted">{followupMessage}</div>
              )}
            </section>

            <section className="mt-6 border border-th rounded-xl bg-th-surface p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-th-primary">Learning report</h2>
                  <div className="mt-1 text-xs text-th-muted">
                    {latestReport?.report
                      ? `Latest report generated ${formatDate(latestReport.generated_at)} with ${latestReport.report.counts.resolved_prs} resolved PR${latestReport.report.counts.resolved_prs === 1 ? "" : "s"}.`
                      : "No learning report generated yet."}
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <FilterSelect
                    label="Window"
                    value={reportRangeDays}
                    onChange={setReportRangeDays}
                    includeAll={false}
                    options={[
                      { value: "14", label: "Last 14 days" },
                      { value: "30", label: "Last 30 days" },
                      { value: "60", label: "Last 60 days" },
                      { value: "90", label: "Last 90 days" },
                    ]}
                  />
                  <button
                    onClick={handleRunReport}
                    disabled={generatingReport}
                    className="h-9 px-3 rounded-lg bg-btn-secondary text-btn-secondary text-sm font-medium hover:bg-btn-secondary-hover disabled:opacity-50 transition-colors"
                  >
                    {jobButtonLabel(reportJob, "Generate report", "Generating...")}
                  </button>
                </div>
              </div>
              {reportMessage && (
                <div className="mt-3 text-xs text-th-muted">{reportMessage}</div>
              )}
              <LearningReportPreview report={latestReport} />
            </section>

            <section className="mt-6 border border-th rounded-xl bg-th-surface p-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-th-primary">Outcome funnel</h2>
                <span className="text-xs text-th-muted">{data.counts.total_work_items} total work item{data.counts.total_work_items === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-4">
                <FunnelStep label="PR linked" value={data.counts.pr_linked_work} total={data.counts.total_work_items} />
                <FunnelStep label="Pending" value={data.counts.pending_prs} total={data.counts.total_work_items} />
                <FunnelStep label="Resolved" value={data.counts.merged_prs + data.counts.closed_unmerged_prs} total={data.counts.total_work_items} />
                <FunnelStep label="Merged" value={data.counts.merged_prs} total={data.counts.total_work_items} />
              </div>
            </section>

            {data.pagination.total_rows === 0 ? (
              <div className="mt-6">
                <EmptyState />
              </div>
            ) : (
              <>
                <section className="mt-6 border border-th rounded-xl bg-th-surface p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                    <FilterSelect label="App" value={appFilter} onChange={updatePagedFilter(setAppFilter)} options={data.filters.apps.map((app) => ({ value: String(app.id), label: app.name }))} />
                    <FilterSelect label="Outcome" value={outcomeFilter} onChange={updatePagedFilter(setOutcomeFilter)} options={OUTCOME_ORDER.map((state) => ({ value: state, label: outcomeLabel(state) }))} />
                    <FilterSelect label="Provider" value={providerFilter} onChange={updatePagedFilter(setProviderFilter)} options={data.filters.providers.map((provider) => ({ value: provider, label: provider }))} />
                    <FilterSelect label="Model" value={modelFilter} onChange={updatePagedFilter(setModelFilter)} options={data.filters.models.map((model) => ({ value: model, label: model }))} />
                    <FilterSelect label="Run status" value={runStatusFilter} onChange={updatePagedFilter(setRunStatusFilter)} options={data.filters.run_statuses.map((status) => ({ value: status, label: status }))} />
                    <FilterSelect label="PR state" value={prStateFilter} onChange={updatePagedFilter(setPrStateFilter)} options={data.filters.pr_states.map((state) => ({ value: state, label: state === "NO_PR" ? "No PR" : state }))} />
                    <FilterSelect label="Rows/group" value={pageSize} onChange={handlePageSizeChange} includeAll={false} options={PAGE_SIZE_OPTIONS.map((size) => ({ value: size, label: `${size} rows` }))} />
                    <button
                      onClick={resetFilters}
                      className="h-9 px-3 rounded-lg bg-btn-secondary text-btn-secondary text-sm font-medium hover:bg-btn-secondary-hover transition-colors"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="mt-3 text-xs text-th-muted">
                    Showing {visibleRowCount} of {filteredRowCount} matching rows across {data.pagination.total_rows} total. Each outcome group paginates independently.
                  </div>
                </section>

                <div className="mt-6 space-y-6">
                  {groupedRows.map((group) => (
                    <OutcomeGroup
                      key={group.state}
                      group={group}
                      onPrevious={() => setGroupPages((current) => ({
                        ...current,
                        [group.state]: Math.max(1, (current[group.state] || 1) - 1),
                      }))}
                      onNext={() => setGroupPages((current) => ({
                        ...current,
                        [group.state]: (current[group.state] || 1) + 1,
                      }))}
                    />
                  ))}
                  {groupedRows.length === 0 && (
                    <div className="border border-th rounded-xl bg-th-surface p-6 text-sm text-th-muted">
                      No rows match the current filters.
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function FunnelStep({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="bg-th-subtle rounded-lg p-3">
      <div className="flex items-center justify-between text-xs text-th-muted">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-th-muted overflow-hidden">
        <div className="h-full bg-st-blue" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 text-lg font-semibold text-th-primary">{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  includeAll = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  includeAll?: boolean;
}) {
  return (
    <label className="min-w-[140px] flex-1">
      <span className="block text-xs font-semibold uppercase tracking-wider text-th-dimmed mb-1.5">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-9 rounded-lg border border-th bg-th-surface text-sm text-th-primary px-2 focus:outline-none focus:border-th-strong"
      >
        {includeAll && <option value="all">All</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function GroupPaginationControls({
  pagination,
  onPrevious,
  onNext,
}: {
  pagination: OutcomeRowsPagination;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (pagination.page_count <= 1) return null;
  const start = (pagination.page - 1) * pagination.page_size + 1;
  const end = Math.min(pagination.filtered_rows, pagination.page * pagination.page_size);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="text-xs text-th-muted">
        Rows {start}-{end} of {pagination.filtered_rows}. Page {pagination.page} of {pagination.page_count}.
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onPrevious}
          disabled={!pagination.has_previous}
          className="h-8 px-2.5 rounded-lg bg-btn-secondary text-btn-secondary text-xs font-medium hover:bg-btn-secondary-hover disabled:opacity-50 transition-colors"
        >
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={!pagination.has_next}
          className="h-8 px-2.5 rounded-lg bg-btn-secondary text-btn-secondary text-xs font-medium hover:bg-btn-secondary-hover disabled:opacity-50 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function LearningReportPreview({ report }: { report: OutcomeLearningReportRun | null }) {
  const content = report?.report;
  if (!content) {
    return (
      <div className="mt-4 border-t border-th pt-4 text-sm text-th-muted">
        Generate a report after syncing GitHub evidence and recomputing snapshots. Only merged and closed-unmerged PRs are used for learning conclusions.
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-th pt-5 text-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">Executive report</div>
          <h3 className="mt-1 text-lg font-semibold text-th-primary">LLM outcome learning report</h3>
        </div>
        <div className="text-xs text-th-muted">
          {formatDate(report.generated_at)} - {report.mode} - {report.status} - {content.range.days ? `last ${content.range.days} days` : "custom range"}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-th text-xs uppercase tracking-wider text-th-dimmed">
            <tr>
              <th className="py-2 pr-4 font-semibold">Resolved PRs</th>
              <th className="py-2 pr-4 font-semibold">Merged</th>
              <th className="py-2 pr-4 font-semibold">Resolved cost</th>
              <th className="py-2 pr-4 font-semibold">At-risk cost</th>
              <th className="py-2 pr-4 font-semibold">Assessment coverage</th>
              <th className="py-2 font-semibold">Excluded</th>
            </tr>
          </thead>
          <tbody className="text-th-secondary">
            <tr className="border-b border-th">
              <td className="py-3 pr-4 text-th-primary font-semibold">{content.counts.resolved_prs}</td>
              <td className="py-3 pr-4">{content.counts.merged_prs} merged, {content.counts.closed_unmerged_prs} closed</td>
              <td className="py-3 pr-4">{formatCurrency(content.costs.resolved_known_cost_usd)}</td>
              <td className="py-3 pr-4">{formatCurrency(content.costs.likely_regression_known_cost_usd ?? 0)} from {content.counts.likely_regression_followups} likely fix{content.counts.likely_regression_followups === 1 ? "" : "es"}</td>
              <td className="py-3 pr-4">{content.counts.assessed_resolved_prs} assessed, {content.costs.unknown_cost_rows} incomplete cost row{content.costs.unknown_cost_rows === 1 ? "" : "s"}</td>
              <td className="py-3">{content.counts.pending_prs_excluded} pending, {content.counts.no_pr_excluded} no PR, {content.counts.unknown_excluded} unknown</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="mt-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">Executive summary</div>
        <ul className="mt-2 space-y-1 text-sm text-th-secondary">
          {content.summary_bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        {content.warnings.length > 0 && (
          <div className="mt-2 text-xs text-st-yellow">{content.warnings[0]}</div>
        )}
      </section>

      <section className="mt-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">Findings</div>
        <div className="mt-2 space-y-4">
        {content.insights.map((insight) => (
          <ReportInsight key={insight.id} insight={insight} />
        ))}
        </div>
      </section>

      {(content.recommendations || []).length > 0 && (
        <section className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">Recommended next actions</div>
          <div className="mt-2 space-y-5">
            {(content.recommendations || []).map((recommendation) => (
              <ReportRecommendation key={recommendation.id} recommendation={recommendation} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ReportInsight({ insight }: { insight: OutcomeLearningReportInsight }) {
  return (
    <section className="border-t border-th pt-3">
      <h4 className="text-sm font-semibold text-th-primary">{insight.title}</h4>
      <p className="mt-1 text-sm text-th-secondary">{insight.summary}</p>
      <ReportEvidenceInline examples={insight.evidence} />
    </section>
  );
}

function ReportRecommendation({ recommendation }: { recommendation: NonNullable<OutcomeLearningReportRun["report"]>["recommendations"][number] }) {
  return (
    <section className="border-t border-th pt-4">
      <h4 className="text-sm font-semibold text-th-primary">{recommendation.title}</h4>
      <p className="mt-1 text-sm text-th-secondary">{recommendation.summary}</p>
      <p className="mt-2 text-sm text-th-muted">{recommendation.action}</p>
      <ReportEvidenceInline examples={recommendation.evidence} />
      {recommendation.artifact && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">{recommendation.artifact.title}</div>
          <pre className="mt-2 max-h-[420px] overflow-auto rounded-lg border border-th bg-th-subtle p-3 text-xs leading-relaxed text-th-secondary whitespace-pre-wrap">
            {recommendation.artifact.body}
          </pre>
        </div>
      )}
    </section>
  );
}

function ReportEvidenceInline({ examples }: { examples: OutcomeLearningReportExample[] }) {
  if (examples.length === 0) return null;
  return (
    <p className="mt-2 text-xs leading-relaxed text-th-muted">
      Evidence: {examples.map((example, index) => (
        <Fragment key={`${example.work_item_id}-${index}`}>
          {index > 0 ? "; " : ""}
          <Link href={`/apps/${example.app_id}/conversation/${example.work_item_id}`} className="text-th-primary hover:underline">
            {example.work_item_title}
          </Link>
          {" "}
          ({example.app_name}, {qualityLabel(example.quality_band)}, {example.known_cost_usd === null ? "unknown cost" : formatCurrency(example.known_cost_usd)}
          {example.pr_url ? (
            <>
              {", "}
              <a href={example.pr_url} target="_blank" rel="noreferrer" className="text-th-secondary hover:underline">
                PR #{example.pr_number || "?"}
              </a>
            </>
          ) : null}
          {example.regression_followup_count > 0 ? `, ${example.regression_followup_count} likely post-merge fix${example.regression_followup_count === 1 ? "" : "es"}` : ""})
          {example.prompt_excerpt ? ` Prompt: "${example.prompt_excerpt}"` : ""}
          {example.assessment_summary ? ` Assessment: ${example.assessment_summary}` : ""}
        </Fragment>
      ))}
    </p>
  );
}

function OutcomeGroup({
  group,
  onPrevious,
  onNext,
}: {
  group: OutcomeRowGroup;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const { state, rows, pagination } = group;

  function toggleRow(rowId: string) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  return (
    <section className="border border-th rounded-xl bg-th-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-th flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded-md border text-xs font-semibold ${outcomeClass(state)}`}>
            {outcomeLabel(state)}
          </span>
          <span className="text-sm text-th-muted">
            {pagination.filtered_rows} matching row{pagination.filtered_rows === 1 ? "" : "s"}
          </span>
        </div>
        <GroupPaginationControls pagination={pagination} onPrevious={onPrevious} onNext={onNext} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-th-subtle text-xs uppercase tracking-wider text-th-dimmed">
            <tr>
              <th className="text-left font-semibold px-4 py-3 min-w-[260px]">Work</th>
              <th className="text-left font-semibold px-4 py-3">Provider</th>
              <th className="text-left font-semibold px-4 py-3">Run</th>
              <th className="text-left font-semibold px-4 py-3">Cost</th>
              <th className="text-left font-semibold px-4 py-3">Branch</th>
              <th className="text-left font-semibold px-4 py-3">PR</th>
              <th className="text-left font-semibold px-4 py-3 min-w-[150px]">Quality</th>
              <th className="text-left font-semibold px-4 py-3 min-w-[170px]">Attribution</th>
              <th className="text-left font-semibold px-4 py-3 min-w-[180px]">Evidence</th>
              <th className="text-left font-semibold px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-th">
            {rows.map((row) => {
              const expanded = expandedRows.has(row.id);
              return (
              <Fragment key={row.id}>
              <tr className="hover:bg-th-subtle/60">
                <td className="px-4 py-3 align-top">
                  <Link href={`/apps/${row.app_id}/conversation/${row.work_item_id}`} className="font-medium text-th-primary hover:underline">
                    {row.work_item_title}
                  </Link>
                  <div className="mt-1 text-xs text-th-muted">{row.app_name} - {row.work_item_status}</div>
                </td>
                <td className="px-4 py-3 align-top text-th-secondary">
                  <div>{row.provider_id || "unknown"}</div>
                  <div className="mt-1 text-xs text-th-muted">{row.model_id || "model unknown"}</div>
                </td>
                <td className="px-4 py-3 align-top text-th-secondary">
                  <div>{row.latest_run_status || row.session_status || "no run"}</div>
                  <div className="mt-1 text-xs text-th-muted">{row.run_count} run{row.run_count === 1 ? "" : "s"}</div>
                </td>
                <td className="px-4 py-3 align-top text-th-secondary">
                  <div>{row.known_cost_usd === null ? "unknown" : formatCurrency(row.known_cost_usd)}</div>
                  {row.unknown_cost_runs > 0 && (
                    <div className="mt-1 text-xs text-st-yellow">{row.unknown_cost_runs} unknown</div>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-th-secondary font-mono text-xs">
                  {row.branch_name || "none"}
                </td>
                <td className="px-4 py-3 align-top text-th-secondary">
                  {row.pr_url ? (
                    <a href={row.pr_url} target="_blank" rel="noreferrer" className="hover:underline">
                      #{row.pr_number || "?"}
                    </a>
                  ) : (
                    "none"
                  )}
                  <div className="mt-1 text-xs text-th-muted">{row.pr_state || "NO_PR"}</div>
                </td>
                <td className="px-4 py-3 align-top text-th-secondary">
                  <span className={`inline-flex px-2 py-1 rounded-md border text-xs font-semibold ${qualityClass(row.quality_band)}`}>
                    {qualityLabel(row.quality_band)}
                  </span>
                  {row.quality_confidence && (
                    <div className="mt-1 text-xs text-th-muted">{row.quality_confidence} confidence</div>
                  )}
                  {row.correction_burden_score !== null && (
                    <div className="mt-1 text-xs text-th-muted">Burden {row.correction_burden_score}</div>
                  )}
                  {row.assessment_status && (
                    <div className="mt-1 text-xs text-th-muted">
                      LLM {row.assessment_status}{row.assessment_confidence ? `, ${row.assessment_confidence}` : ""}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-th-secondary">
                  {row.snapshot_computed_at ? (
                    <>
                      <div className="text-xs text-th-muted">
                        Agent {row.agent_commit_count ?? 0}, coauthored {row.coauthored_commit_count ?? 0}
                      </div>
                      <div className="mt-1 text-xs text-th-muted">
                        Human {row.human_commit_count ?? 0}, after agent {row.human_after_agent_commit_count ?? 0}
                      </div>
                      <div className="mt-1 text-xs text-th-muted">
                        PR {attributionLabel(row.pr_author_classification)}
                        {row.pr_author_login ? ` (${row.pr_author_login})` : ""}
                      </div>
                      {row.attribution_confidence && (
                        <div className="mt-1 text-xs text-th-muted">{row.attribution_confidence} attribution</div>
                      )}
                      {(row.unknown_commit_count || 0) > 0 && (
                        <div className="mt-1 text-xs text-st-yellow">{row.unknown_commit_count} unknown commits</div>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-th-muted">not computed</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-th-secondary">
                  <div>{row.evidence_completeness.replaceAll("_", " ")}</div>
                  {row.github_evidence_synced_at && (
                    <div className="mt-1 text-xs text-th-muted">
                      {(row.github_issue_comments_count || 0) + (row.github_review_comments_count || 0)} comments, {row.github_reviews_count || 0} reviews, {row.github_commits_count || 0} commits
                    </div>
                  )}
                  {row.github_additions !== null && row.github_deletions !== null && (
                    <div className="mt-1 text-xs text-th-muted">
                      +{row.github_additions} / -{row.github_deletions}
                      {row.github_changed_files !== null ? `, ${row.github_changed_files} files` : ""}
                    </div>
                  )}
                  {row.warnings.length > 0 && (
                    <div className="mt-1 text-xs text-st-yellow">{row.warnings[0]}</div>
                  )}
                  {row.snapshot_computed_at && (
                    <div className="mt-1 text-xs text-th-muted">Snapshot {formatDate(row.snapshot_computed_at)}</div>
                  )}
                  {row.assessment_created_at && (
                    <div className="mt-1 text-xs text-th-muted">Assessment {formatDate(row.assessment_created_at)}</div>
                  )}
                  {row.followup_count > 0 && (
                    <div className={row.regression_followup_count > 0 ? "mt-1 text-xs text-st-yellow" : "mt-1 text-xs text-th-muted"}>
                      {row.followup_count} follow-up{row.followup_count === 1 ? "" : "s"}
                      {row.regression_followup_count > 0 ? `, ${row.regression_followup_count} likely fix${row.regression_followup_count === 1 ? "" : "es"}` : ""}
                    </div>
                  )}
                  {row.snapshot_evidence && (
                    <button
                      onClick={() => toggleRow(row.id)}
                      aria-expanded={expanded}
                      className="mt-2 inline-flex items-center gap-1 h-7 px-2 rounded-md bg-btn-secondary text-btn-secondary text-xs font-medium hover:bg-btn-secondary-hover transition-colors"
                    >
                      {expanded ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
                      Details
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-th-muted text-xs">
                  {formatDate(row.updated_at)}
                </td>
              </tr>
              {expanded && row.snapshot_evidence && (
                <tr>
                  <td colSpan={10} className="px-4 py-4 bg-th-subtle/60">
                    <OutcomeEvidenceDetails row={row} />
                  </td>
                </tr>
              )}
              </Fragment>
            );})}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OutcomeEvidenceDetails({ row }: { row: OutcomeRow }) {
  const evidence = row.snapshot_evidence;
  if (!evidence) return null;
  const commits = evidence.commit_classifications.slice(0, 8);
  const hiddenCommitCount = Math.max(0, evidence.commit_classifications.length - commits.length);
  const assessment = evidence.llm_assessment;

  return (
    <div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">Quality rule</div>
        <div className="mt-2 text-sm text-th-secondary">{evidence.quality_reason || "No quality reason recorded."}</div>
        {evidence.deterministic_quality_band && evidence.deterministic_quality_band !== row.quality_band && (
          <div className="mt-2 text-xs text-th-muted">
            Deterministic: {qualityLabel(evidence.deterministic_quality_band)}
          </div>
        )}
        {evidence.assessment_quality_reason && (
          <div className="mt-2 text-xs text-th-muted">{evidence.assessment_quality_reason}</div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-th-muted">
          <div>Review comments: {evidence.correction_burden_inputs.review_comment_count}</div>
          <div>Changes requested: {evidence.correction_burden_inputs.changes_requested_count}</div>
          <div>Human after agent: {evidence.correction_burden_inputs.human_after_agent_commit_count}</div>
          <div>Extra issue comments: {evidence.correction_burden_inputs.extra_issue_comment_count}</div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">Attribution</div>
        <div className="mt-2 text-sm text-th-secondary">{evidence.attribution_reason || "No attribution reason recorded."}</div>
        <div className="mt-3 text-xs text-th-muted">
          PR author: {attributionLabel(evidence.pr_author.classification)}
          {evidence.pr_author.login ? ` (${evidence.pr_author.login})` : ""}, {evidence.pr_author.confidence} confidence
        </div>
        {evidence.pr_artifact_warnings.length > 0 && (
          <div className="mt-2 text-xs text-st-yellow">{evidence.pr_artifact_warnings[0]}</div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">LLM assessment</div>
        {assessment ? (
          <>
            <div className="mt-2 text-sm text-th-secondary">{assessment.summary || row.assessment_summary || "No assessment summary recorded."}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-th-muted">
              <div>Pressure: {assessment.review_pressure}</div>
              <div>Follow-up: {followupTypeLabel(assessment.human_followup_type)}</div>
              <div>Requested: {assessment.comment_categories.requested_change}</div>
              <div>Regression: {assessment.comment_categories.bug_or_regression}</div>
              <div>Clarification: {assessment.comment_categories.clarification}</div>
              <div>Correction commits: {assessment.agent_correction_commit_count}</div>
            </div>
            {assessment.evidence_ids.length > 0 && (
              <div className="mt-2 text-xs text-th-dimmed">Evidence IDs: {assessment.evidence_ids.slice(0, 6).join(", ")}</div>
            )}
          </>
        ) : (
          <div className="mt-2 text-sm text-th-muted">
            {row.assessment_status === "failed" ? "Assessment failed for this snapshot." : "No LLM assessment recorded."}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">Commit evidence</div>
        {commits.length === 0 ? (
          <div className="mt-2 text-sm text-th-muted">No synced commit classifications.</div>
        ) : (
          <div className="mt-2 space-y-2">
            {commits.map((commit) => (
              <div key={commit.sha} className="text-xs text-th-muted">
                <span className="font-mono text-th-secondary">{commit.sha.slice(0, 7)}</span>
                {" - "}
                <span>{commitClassificationLabel(commit.classification)}</span>
                {commit.author_login ? <span> by {commit.author_login}</span> : null}
                {commit.signals.length > 0 && (
                  <div className="mt-0.5 text-th-dimmed">{commit.signals.join(", ")}</div>
                )}
              </div>
            ))}
            {hiddenCommitCount > 0 && (
              <div className="text-xs text-th-muted">+{hiddenCommitCount} more commit{hiddenCommitCount === 1 ? "" : "s"}</div>
            )}
          </div>
        )}
      </div>
    </div>
    {row.followup_evidence.length > 0 && (
      <div className="mt-4 border-t border-th pt-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-th-dimmed">Post-merge follow-ups</div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
          {row.followup_evidence.map((followup) => (
            <div key={followup.id} className="rounded-lg bg-th-surface border border-th p-3 text-xs">
              <div className="font-semibold text-th-primary">
                {followupRelationLabel(followup.relation_type)} - {followup.confidence}
              </div>
              <div className="mt-1 text-th-muted">
                {followup.followup_pr_url ? (
                  <a href={followup.followup_pr_url} target="_blank" rel="noreferrer" className="hover:underline">
                    PR #{followup.followup_pr_number}
                  </a>
                ) : (
                  `PR #${followup.followup_pr_number}`
                )}
                {followup.followup_title ? ` - ${followup.followup_title}` : ""}
              </div>
              {followup.summary && (
                <div className="mt-2 text-th-secondary">{followup.summary}</div>
              )}
              {followup.deterministic_signals.length > 0 && (
                <div className="mt-2 text-th-dimmed">{followup.deterministic_signals.slice(0, 4).join(", ")}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    )}
    </div>
  );
}
