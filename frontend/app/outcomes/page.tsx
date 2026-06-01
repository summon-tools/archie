"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { getOutcomesSettings, getOutcomesSummary, recomputeOutcomeSnapshots, syncOutcomesGitHubEvidence, updateOutcomesSettings } from "@/lib/api";
import type { OutcomeQualityBand, OutcomeRow, OutcomesGitHubSyncSettings, OutcomesSummaryResponse, OutcomeState } from "@/lib/types";

const OUTCOME_ORDER: OutcomeState[] = ["pending_pr", "merged", "closed_unmerged", "no_pr", "unknown"];

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [syncRangeDays, setSyncRangeDays] = useState("14");
  const [appFilter, setAppFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [runStatusFilter, setRunStatusFilter] = useState("all");
  const [prStateFilter, setPrStateFilter] = useState("all");

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([getOutcomesSummary(), getOutcomesSettings()])
      .then(([summary, loadedSettings]) => {
        setData(summary);
        setSettings(loadedSettings);
        setSyncRangeDays(String(loadedSettings.observation_window_days));
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load outcomes"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const syncedEvidenceRows = useMemo(() => {
    return data?.rows.filter((row) => row.github_evidence_synced_at).length || 0;
  }, [data?.rows]);

  const computedSnapshotRows = useMemo(() => {
    return data?.rows.filter((row) => row.snapshot_computed_at).length || 0;
  }, [data?.rows]);

  const qualityCounts = useMemo(() => {
    const counts = new Map<OutcomeQualityBand, number>();
    for (const row of data?.rows || []) {
      if (!row.quality_band) continue;
      counts.set(row.quality_band, (counts.get(row.quality_band) || 0) + 1);
    }
    return counts;
  }, [data?.rows]);

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
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncOutcomesGitHubEvidence({ range_days: days });
      setSyncMessage(`Synced ${result.run.synced_count} of ${result.run.scanned_count} PRs${result.run.failed_count ? `, ${result.run.failed_count} failed` : ""}. Recomputed ${result.recomputed_snapshots ?? 0} snapshots.`);
      const [summary, loadedSettings] = await Promise.all([getOutcomesSummary(), getOutcomesSettings()]);
      setData(summary);
      setSettings(loadedSettings);
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "GitHub evidence sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRecomputeSnapshots() {
    setRecomputing(true);
    setSnapshotMessage(null);
    try {
      const result = await recomputeOutcomeSnapshots();
      setSnapshotMessage(`Recomputed ${result.recomputed_count} outcome snapshot${result.recomputed_count === 1 ? "" : "s"}.`);
      const summary = await getOutcomesSummary();
      setData(summary);
    } catch (err) {
      setSnapshotMessage(err instanceof Error ? err.message : "Outcome snapshot recompute failed");
    } finally {
      setRecomputing(false);
    }
  }

  const filteredRows = useMemo(() => {
    const rows = data?.rows || [];
    return rows.filter((row) => {
      if (appFilter !== "all" && String(row.app_id) !== appFilter) return false;
      if (outcomeFilter !== "all" && row.outcome_state !== outcomeFilter) return false;
      if (providerFilter !== "all" && row.provider_id !== providerFilter) return false;
      if (modelFilter !== "all" && row.model_id !== modelFilter) return false;
      if (runStatusFilter !== "all" && row.latest_run_status !== runStatusFilter) return false;
      if (prStateFilter !== "all" && (row.pr_state || "NO_PR") !== prStateFilter) return false;
      return true;
    });
  }, [appFilter, data?.rows, modelFilter, outcomeFilter, prStateFilter, providerFilter, runStatusFilter]);

  const groupedRows = useMemo(() => {
    return OUTCOME_ORDER.map((state) => ({
      state,
      rows: filteredRows.filter((row) => row.outcome_state === state),
    })).filter((group) => group.rows.length > 0);
  }, [filteredRows]);

  const prStates = useMemo(() => {
    const values = new Set<string>();
    for (const row of data?.rows || []) values.add(row.pr_state || "NO_PR");
    return Array.from(values).sort();
  }, [data?.rows]);

  const resetFilters = () => {
    setAppFilter("all");
    setOutcomeFilter("all");
    setProviderFilter("all");
    setModelFilter("all");
    setRunStatusFilter("all");
    setPrStateFilter("all");
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
                    {syncing ? "Syncing..." : "Sync now"}
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
                    {computedSnapshotRows} computed. Strong {qualityCounts.get("strong") || 0}, useful {qualityCounts.get("useful") || 0}, costly rework {qualityCounts.get("costly_reworked") || 0}, pending {qualityCounts.get("pending") || 0}.
                  </div>
                </div>
                <button
                  onClick={handleRecomputeSnapshots}
                  disabled={recomputing}
                  className="h-9 px-3 rounded-lg bg-btn-secondary text-btn-secondary text-sm font-medium hover:bg-btn-secondary-hover disabled:opacity-50 transition-colors"
                >
                  {recomputing ? "Computing..." : "Recompute"}
                </button>
              </div>
              {snapshotMessage && (
                <div className="mt-3 text-xs text-th-muted">{snapshotMessage}</div>
              )}
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

            {data.rows.length === 0 ? (
              <div className="mt-6">
                <EmptyState />
              </div>
            ) : (
              <>
                <section className="mt-6 border border-th rounded-xl bg-th-surface p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                    <FilterSelect label="App" value={appFilter} onChange={setAppFilter} options={data.filters.apps.map((app) => ({ value: String(app.id), label: app.name }))} />
                    <FilterSelect label="Outcome" value={outcomeFilter} onChange={setOutcomeFilter} options={OUTCOME_ORDER.map((state) => ({ value: state, label: outcomeLabel(state) }))} />
                    <FilterSelect label="Provider" value={providerFilter} onChange={setProviderFilter} options={data.filters.providers.map((provider) => ({ value: provider, label: provider }))} />
                    <FilterSelect label="Model" value={modelFilter} onChange={setModelFilter} options={data.filters.models.map((model) => ({ value: model, label: model }))} />
                    <FilterSelect label="Run status" value={runStatusFilter} onChange={setRunStatusFilter} options={data.filters.run_statuses.map((status) => ({ value: status, label: status }))} />
                    <FilterSelect label="PR state" value={prStateFilter} onChange={setPrStateFilter} options={prStates.map((state) => ({ value: state, label: state === "NO_PR" ? "No PR" : state }))} />
                    <button
                      onClick={resetFilters}
                      className="h-9 px-3 rounded-lg bg-btn-secondary text-btn-secondary text-sm font-medium hover:bg-btn-secondary-hover transition-colors"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="mt-3 text-xs text-th-muted">
                    Showing {filteredRows.length} of {data.rows.length} rows.
                  </div>
                </section>

                <div className="mt-6 space-y-6">
                  {groupedRows.map((group) => (
                    <OutcomeGroup key={group.state} state={group.state} rows={group.rows} />
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

function OutcomeGroup({ state, rows }: { state: OutcomeState; rows: OutcomeRow[] }) {
  return (
    <section className="border border-th rounded-xl bg-th-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-th flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded-md border text-xs font-semibold ${outcomeClass(state)}`}>
            {outcomeLabel(state)}
          </span>
          <span className="text-sm text-th-muted">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
        </div>
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
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-th-subtle/60">
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
                </td>
                <td className="px-4 py-3 align-top text-th-muted text-xs">
                  {formatDate(row.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
