import * as dal from "@/lib/server/dal";
import { getDb } from "@/lib/server/db";
import { recomputeOutcomeSnapshots } from "@/lib/server/outcome-snapshots";
import { buildOutcomesSummary } from "@/lib/server/outcomes";
import type { AppRow, LlmOutcomeReportRow } from "@/lib/server/types";
import type {
  OutcomeLearningReportContent,
  OutcomeLearningReportExample,
  OutcomeLearningReportInsight,
  OutcomeLearningReportRun,
  OutcomeRow,
} from "@/lib/types";

export interface RunOutcomeLearningReportOptions {
  apps: AppRow[];
  userId?: number | null;
  mode?: "manual" | "scheduled";
  rangeStart?: string | null;
  rangeEnd?: string | null;
  rangeDays?: number | null;
  generatedAt?: string;
}

function isoDaysAgo(days: number, from: Date): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildRange(options: Pick<RunOutcomeLearningReportOptions, "rangeStart" | "rangeEnd" | "rangeDays" | "generatedAt">) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const end = options.rangeEnd || generatedAt;
  const days = options.rangeDays && options.rangeDays > 0 ? options.rangeDays : null;
  const start = options.rangeStart || (days ? isoDaysAgo(days, new Date(end)) : null);
  return { start, end, days };
}

function inRange(row: OutcomeRow, range: { start: string | null; end: string | null }): boolean {
  const value = parseDate(row.updated_at);
  if (value === null) return true;
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  if (start !== null && value < start) return false;
  if (end !== null && value > end) return false;
  return true;
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function loadPromptExcerpts(conversationIds: number[]): Map<number, string> {
  const ids = Array.from(new Set(conversationIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return new Map();
  const placeholders = Array(ids.length).fill("?").join(", ");
  const rows = getDb().prepare(`
    SELECT m.conversation_id AS conversation_id, m.body_md AS body_md
    FROM messages m
    JOIN (
      SELECT conversation_id, MIN(seq) AS first_seq
      FROM messages
      WHERE role = 'user' AND conversation_id IN (${placeholders})
      GROUP BY conversation_id
    ) first_user ON first_user.conversation_id = m.conversation_id AND first_user.first_seq = m.seq
  `).all(...ids) as Array<{ conversation_id: number; body_md: string }>;
  return new Map(rows.map((row) => [row.conversation_id, truncate(row.body_md, 240) || ""]));
}

function sumKnownCost(rows: OutcomeRow[]): number {
  return rows.reduce((sum, row) => sum + (row.known_cost_usd ?? 0), 0);
}

function toExample(row: OutcomeRow, promptExcerpts: Map<number, string>): OutcomeLearningReportExample {
  const assessment = row.snapshot_evidence?.llm_assessment || null;
  return {
    app_id: row.app_id,
    app_name: row.app_name,
    work_item_id: row.work_item_id,
    work_item_title: row.work_item_title,
    conversation_id: row.conversation_id,
    provider_id: row.provider_id,
    model_id: row.model_id,
    outcome_state: row.outcome_state,
    quality_band: row.quality_band,
    known_cost_usd: row.known_cost_usd,
    unknown_cost_runs: row.unknown_cost_runs,
    pr_number: row.pr_number,
    pr_url: row.pr_url,
    assessment_summary: row.assessment_summary || assessment?.summary || null,
    assessment_confidence: row.assessment_confidence || assessment?.confidence || null,
    prompt_excerpt: row.conversation_id ? promptExcerpts.get(row.conversation_id) || null : null,
    evidence_ids: assessment?.evidence_ids || [],
  };
}

function buildInsight(id: string, title: string, summary: string, rows: OutcomeRow[], promptExcerpts: Map<number, string>): OutcomeLearningReportInsight {
  return {
    id,
    title,
    summary,
    evidence: rows.slice(0, 3).map((row) => toExample(row, promptExcerpts)),
  };
}

function sortByEvidenceWeight(rows: OutcomeRow[]): OutcomeRow[] {
  return rows.slice().sort((left, right) => {
    const leftWeight = (left.known_cost_usd || 0) + (left.correction_burden_score || 0) + (left.github_review_comments_count || 0);
    const rightWeight = (right.known_cost_usd || 0) + (right.correction_burden_score || 0) + (right.github_review_comments_count || 0);
    return rightWeight - leftWeight;
  });
}

function buildReportContent(input: {
  rows: OutcomeRow[];
  range: { start: string | null; end: string | null; days: number | null };
  generatedAt: string;
  warnings: string[];
}): OutcomeLearningReportContent {
  const rows = input.rows.filter((row) => inRange(row, input.range));
  const resolvedRows = rows.filter((row) => row.outcome_state === "merged" || row.outcome_state === "closed_unmerged");
  const mergedRows = resolvedRows.filter((row) => row.outcome_state === "merged");
  const closedRows = resolvedRows.filter((row) => row.outcome_state === "closed_unmerged");
  const strongRows = sortByEvidenceWeight(mergedRows.filter((row) => row.quality_band === "strong"));
  const costlyRows = sortByEvidenceWeight(mergedRows.filter((row) => row.quality_band === "costly_reworked"));
  const clarificationRows = sortByEvidenceWeight(mergedRows.filter((row) => {
    const assessment = row.snapshot_evidence?.llm_assessment;
    if (!assessment) return false;
    return (
      row.quality_band !== "costly_reworked" &&
      (assessment.human_followup_type === "clarification" ||
        assessment.human_followup_type === "expected_iteration" ||
        assessment.comment_categories.clarification > 0)
    );
  }));
  const lowConfidenceRows = sortByEvidenceWeight(resolvedRows.filter((row) => {
    return row.quality_confidence === "low" || row.attribution_confidence === "low" || row.assessment_confidence === "low" || !row.snapshot_evidence;
  }));
  const promptExcerpts = loadPromptExcerpts(rows.map((row) => row.conversation_id).filter((id): id is number => id !== null));

  const insights: OutcomeLearningReportInsight[] = [];
  if (strongRows.length > 0) {
    insights.push(buildInsight(
      "strong_outcomes",
      "Strong merged outcomes worth copying",
      `${strongRows.length} merged PR${strongRows.length === 1 ? "" : "s"} had low review pressure and no detected correction burden.`,
      strongRows,
      promptExcerpts,
    ));
  }
  if (costlyRows.length > 0) {
    insights.push(buildInsight(
      "costly_rework",
      "Merged work with correction burden",
      `${costlyRows.length} merged PR${costlyRows.length === 1 ? "" : "s"} carried costly rework signals from comments, reviews, or human follow-up commits.`,
      costlyRows,
      promptExcerpts,
    ));
  }
  if (clarificationRows.length > 0) {
    insights.push(buildInsight(
      "clarification_not_rework",
      "Clarification-heavy review is not always rework",
      `${clarificationRows.length} merged PR${clarificationRows.length === 1 ? "" : "s"} had clarification or expected-iteration evidence without being classified as correction work.`,
      clarificationRows,
      promptExcerpts,
    ));
  }
  if (closedRows.length > 0) {
    insights.push(buildInsight(
      "closed_unmerged",
      "Closed-unmerged sessions need separate review",
      `${closedRows.length} PR${closedRows.length === 1 ? " was" : "s were"} closed without merge in this window, so they should be reviewed as abandoned outcomes rather than learning wins.`,
      sortByEvidenceWeight(closedRows),
      promptExcerpts,
    ));
  }
  if (lowConfidenceRows.length > 0) {
    insights.push(buildInsight(
      "evidence_gaps",
      "Evidence gaps reduce learning confidence",
      `${lowConfidenceRows.length} resolved row${lowConfidenceRows.length === 1 ? "" : "s"} had low-confidence or missing evidence; sync/assessment coverage should improve before drawing stronger conclusions.`,
      lowConfidenceRows,
      promptExcerpts,
    ));
  }
  if (insights.length === 0) {
    insights.push({
      id: "no_resolved_evidence",
      title: "No resolved PR evidence yet",
      summary: "This window has no merged or closed-unmerged PRs with enough local evidence to produce learning conclusions.",
      evidence: [],
    });
  }

  const pendingRows = rows.filter((row) => row.outcome_state === "pending_pr");
  const noPrRows = rows.filter((row) => row.outcome_state === "no_pr");
  const unknownRows = rows.filter((row) => row.outcome_state === "unknown");
  const assessedResolved = resolvedRows.filter((row) => row.assessment_status === "completed");
  const costlyCost = sumKnownCost(costlyRows);
  const resolvedCost = sumKnownCost(resolvedRows);

  const summaryBullets = [
    `${resolvedRows.length} resolved PR${resolvedRows.length === 1 ? "" : "s"} are included; ${pendingRows.length} pending PR${pendingRows.length === 1 ? "" : "s"} are excluded from conclusions.`,
    `${mergedRows.length} merged PR${mergedRows.length === 1 ? "" : "s"}, ${closedRows.length} closed-unmerged PR${closedRows.length === 1 ? "" : "s"}, and ${assessedResolved.length} resolved PR${assessedResolved.length === 1 ? "" : "s"} with LLM evidence assessment.`,
    `Known resolved LLM cost is $${resolvedCost.toFixed(4)}; costly-rework known cost is $${costlyCost.toFixed(4)}.`,
  ];

  return {
    version: 1,
    generated_at: input.generatedAt,
    range: input.range,
    counts: {
      total_work_items: rows.length,
      resolved_prs: resolvedRows.length,
      merged_prs: mergedRows.length,
      closed_unmerged_prs: closedRows.length,
      pending_prs_excluded: pendingRows.length,
      no_pr_excluded: noPrRows.length,
      unknown_excluded: unknownRows.length,
      assessed_resolved_prs: assessedResolved.length,
    },
    costs: {
      resolved_known_cost_usd: resolvedCost,
      merged_known_cost_usd: sumKnownCost(mergedRows),
      costly_rework_known_cost_usd: costlyCost,
      unknown_cost_rows: resolvedRows.filter((row) => row.known_cost_usd === null || row.unknown_cost_runs > 0).length,
    },
    summary_bullets: summaryBullets,
    insights,
    sections: {
      strong_examples: strongRows.slice(0, 5).map((row) => toExample(row, promptExcerpts)),
      costly_rework_examples: costlyRows.slice(0, 5).map((row) => toExample(row, promptExcerpts)),
      clarification_examples: clarificationRows.slice(0, 5).map((row) => toExample(row, promptExcerpts)),
      abandoned_examples: sortByEvidenceWeight(closedRows).slice(0, 5).map((row) => toExample(row, promptExcerpts)),
      low_confidence_examples: lowConfidenceRows.slice(0, 5).map((row) => toExample(row, promptExcerpts)),
    },
    warnings: input.warnings,
  };
}

function parseWarnings(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseReport(value: string | null): OutcomeLearningReportContent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as OutcomeLearningReportContent : null;
  } catch {
    return null;
  }
}

export function serializeOutcomeLearningReport(row: LlmOutcomeReportRow | undefined): OutcomeLearningReportRun | null {
  if (!row) return null;
  return {
    id: row.id,
    requested_by_user_id: row.requested_by_user_id,
    mode: row.mode,
    status: row.status,
    range_start: row.range_start,
    range_end: row.range_end,
    range_days: row.range_days,
    total_work_items: row.total_work_items,
    resolved_pr_count: row.resolved_pr_count,
    report: parseReport(row.report_json),
    warnings: parseWarnings(row.warnings_json),
    error_text: row.error_text,
    generated_at: row.generated_at,
    created_at: row.created_at,
  };
}

export async function runOutcomeLearningReport(options: RunOutcomeLearningReportOptions): Promise<OutcomeLearningReportRun> {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const range = buildRange({ ...options, generatedAt });
  try {
    recomputeOutcomeSnapshots({
      apps: options.apps,
      rangeDays: range.start ? null : range.days,
      rangeStart: range.start,
      rangeEnd: range.end,
      computedAt: generatedAt,
    });
    const summary = await buildOutcomesSummary({
      apps: options.apps,
      githubUnavailableWarning: "Report uses local and synced GitHub evidence; run GitHub sync first when freshness matters.",
      maxGithubLookups: 0,
    });
    const content = buildReportContent({
      rows: summary.rows,
      range,
      generatedAt,
      warnings: summary.warnings,
    });
    const row = dal.createLlmOutcomeReport({
      requested_by_user_id: options.userId ?? null,
      mode: options.mode || "manual",
      status: "completed",
      range_start: range.start,
      range_end: range.end,
      range_days: range.days,
      total_work_items: content.counts.total_work_items,
      resolved_pr_count: content.counts.resolved_prs,
      report_json: JSON.stringify(content),
      warnings_json: JSON.stringify(content.warnings),
      generated_at: generatedAt,
    });
    return serializeOutcomeLearningReport(row)!;
  } catch (error) {
    const row = dal.createLlmOutcomeReport({
      requested_by_user_id: options.userId ?? null,
      mode: options.mode || "manual",
      status: "failed",
      range_start: range.start,
      range_end: range.end,
      range_days: range.days,
      error_text: error instanceof Error ? error.message : "Outcome learning report generation failed",
      generated_at: generatedAt,
    });
    return serializeOutcomeLearningReport(row)!;
  }
}
