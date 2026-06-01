import type {
  OutcomeAttributionConfidence,
  OutcomeConfidence,
  OutcomeEvidenceAssessment,
  OutcomeHumanFollowupType,
  OutcomeQualityBand,
  OutcomeReviewPressure,
  OutcomeState,
} from "@/lib/types";

const REVIEW_PRESSURES: OutcomeReviewPressure[] = ["low", "medium", "high", "unknown"];
const FOLLOWUP_TYPES: OutcomeHumanFollowupType[] = [
  "none",
  "clarification",
  "expected_iteration",
  "agent_correction",
  "unrelated_extension",
  "unknown",
];
const CONFIDENCES: OutcomeAttributionConfidence[] = ["unknown", "low", "medium", "high"];

export const OUTCOME_ASSESSMENT_COMMENT_CATEGORIES = [
  "clarification",
  "requested_change",
  "bug_or_regression",
  "nit",
  "approval_or_positive",
  "other",
] as const;

type CommentCategory = typeof OUTCOME_ASSESSMENT_COMMENT_CATEGORIES[number];

export interface DeterministicQuality {
  qualityBand: OutcomeQualityBand;
  confidence: OutcomeConfidence;
  correctionBurdenScore: number;
  reason: string;
}

export interface AppliedAssessmentQuality extends DeterministicQuality {
  deterministicQualityBand: OutcomeQualityBand;
  deterministicQualityReason: string;
  assessmentQualityReason: string | null;
  assessmentApplied: boolean;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function asCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function normalizeOutcomeEvidenceAssessment(value: unknown): OutcomeEvidenceAssessment {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawCategories = source.comment_categories && typeof source.comment_categories === "object"
    ? source.comment_categories as Record<string, unknown>
    : {};
  const commentCategories = OUTCOME_ASSESSMENT_COMMENT_CATEGORIES.reduce((acc, key) => {
    acc[key] = asCount(rawCategories[key]);
    return acc;
  }, {} as Record<CommentCategory, number>);

  return {
    review_pressure: asEnum(source.review_pressure, REVIEW_PRESSURES, "unknown"),
    comment_categories: {
      clarification: commentCategories.clarification,
      requested_change: commentCategories.requested_change,
      bug_or_regression: commentCategories.bug_or_regression,
      nit: commentCategories.nit,
      approval_or_positive: commentCategories.approval_or_positive,
      other: commentCategories.other,
    },
    human_followup_type: asEnum(source.human_followup_type, FOLLOWUP_TYPES, "unknown"),
    agent_correction_commit_count: asCount(source.agent_correction_commit_count),
    confidence: asEnum(source.confidence, CONFIDENCES, "unknown"),
    evidence_ids: Array.isArray(source.evidence_ids)
      ? source.evidence_ids.map((entry) => String(entry)).filter(Boolean).slice(0, 25)
      : [],
    summary: typeof source.summary === "string" ? source.summary.trim().slice(0, 500) : "",
  };
}

export function parseOutcomeEvidenceAssessment(value: string | null): OutcomeEvidenceAssessment | null {
  if (!value) return null;
  try {
    return normalizeOutcomeEvidenceAssessment(JSON.parse(value));
  } catch {
    return null;
  }
}

function confidenceForAppliedAssessment(confidence: OutcomeAttributionConfidence, fallback: OutcomeConfidence): OutcomeConfidence {
  if (confidence === "high") return "high";
  if (confidence === "medium") return "medium";
  return fallback;
}

function baseResult(quality: DeterministicQuality, assessmentQualityReason: string | null = null): AppliedAssessmentQuality {
  return {
    ...quality,
    deterministicQualityBand: quality.qualityBand,
    deterministicQualityReason: quality.reason,
    assessmentQualityReason,
    assessmentApplied: false,
  };
}

export function applyOutcomeEvidenceAssessment(input: {
  outcomeState: OutcomeState;
  deterministic: DeterministicQuality;
  assessment: OutcomeEvidenceAssessment | null;
}): AppliedAssessmentQuality {
  const { outcomeState, deterministic, assessment } = input;
  if (!assessment) return baseResult(deterministic);
  if (assessment.confidence === "unknown" || assessment.confidence === "low") {
    return baseResult(deterministic, "LLM evidence assessment was present but too low confidence to change the deterministic quality band.");
  }
  if (outcomeState !== "merged") {
    return baseResult(deterministic, "LLM evidence assessment is recorded, but only merged PRs use it to adjust final quality.");
  }

  const categories = assessment.comment_categories;
  const explicitCorrection =
    assessment.human_followup_type === "agent_correction" ||
    assessment.agent_correction_commit_count > 0 ||
    categories.bug_or_regression > 0 ||
    (assessment.review_pressure === "high" && categories.requested_change > 0);
  if (explicitCorrection) {
    const reason = "The pull request merged, and the LLM evidence assessment identified agent correction, regression, or high-pressure requested-change evidence.";
    return {
      ...deterministic,
      qualityBand: "costly_reworked",
      confidence: confidenceForAppliedAssessment(assessment.confidence, deterministic.confidence),
      reason,
      deterministicQualityBand: deterministic.qualityBand,
      deterministicQualityReason: deterministic.reason,
      assessmentQualityReason: reason,
      assessmentApplied: true,
    };
  }

  const nonCorrectionFollowup =
    assessment.human_followup_type === "none" ||
    assessment.human_followup_type === "clarification" ||
    assessment.human_followup_type === "expected_iteration" ||
    assessment.human_followup_type === "unrelated_extension";
  const cleanAssessment =
    nonCorrectionFollowup &&
    categories.bug_or_regression === 0 &&
    categories.requested_change === 0 &&
    assessment.agent_correction_commit_count === 0;

  if (cleanAssessment && assessment.review_pressure === "low") {
    const reason = "The pull request merged, and the LLM evidence assessment found low review pressure without correction-oriented comments or commits.";
    return {
      ...deterministic,
      qualityBand: "strong",
      confidence: confidenceForAppliedAssessment(assessment.confidence, deterministic.confidence),
      reason,
      deterministicQualityBand: deterministic.qualityBand,
      deterministicQualityReason: deterministic.reason,
      assessmentQualityReason: reason,
      assessmentApplied: true,
    };
  }

  if (cleanAssessment && deterministic.qualityBand === "costly_reworked") {
    const reason = "The deterministic pass detected rework signals, but the LLM evidence assessment classified them as clarification, expected iteration, or unrelated follow-up rather than agent correction.";
    return {
      ...deterministic,
      qualityBand: "useful",
      confidence: confidenceForAppliedAssessment(assessment.confidence, deterministic.confidence),
      reason,
      deterministicQualityBand: deterministic.qualityBand,
      deterministicQualityReason: deterministic.reason,
      assessmentQualityReason: reason,
      assessmentApplied: true,
    };
  }

  if (assessment.review_pressure === "medium" || categories.requested_change > 0 || assessment.human_followup_type === "unknown") {
    const reason = "The pull request merged, and the LLM evidence assessment found moderate or ambiguous review pressure without clear agent-correction evidence.";
    return {
      ...deterministic,
      qualityBand: deterministic.qualityBand === "strong" ? "useful" : deterministic.qualityBand,
      confidence: confidenceForAppliedAssessment(assessment.confidence, deterministic.confidence),
      reason,
      deterministicQualityBand: deterministic.qualityBand,
      deterministicQualityReason: deterministic.reason,
      assessmentQualityReason: reason,
      assessmentApplied: true,
    };
  }

  return baseResult(deterministic, "LLM evidence assessment did not provide enough signal to adjust the deterministic quality band.");
}
