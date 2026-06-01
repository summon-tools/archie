// ── Conversation-first frontend types ──────────────────────────────

export type ConversationKind = "task" | "chat" | "conversation";
export type WorkItemKind = "task" | "setup";
export type WorkItemStatus = "proposed" | "in_progress" | "done";

export interface WorkItemCounts {
  proposed: number;
  in_progress: number;
  done: number;
}

export interface App {
  id: number;
  name: string;
  port: number;
  description: string;
  directory: string;
  github_repo: string;
  project_owner_user_id: number | null;
  is_running: boolean;
  work_item_counts: WorkItemCounts;
  seed_script: string | null;
  created_at: string;
}

export const TTS_VOICES = [
  { id: "en-US-AndrewNeural", label: "Andrew (English)" },
  { id: "en-US-BrianNeural", label: "Brian (English)" },
  { id: "en-US-AvaNeural", label: "Ava (English)" },
  { id: "en-US-EmmaNeural", label: "Emma (English)" },
  { id: "fr-FR-HenriNeural", label: "Henri (Français)" },
  { id: "fr-FR-DeniseNeural", label: "Denise (Français)" },
] as const;

export const DEFAULT_TTS_VOICE = "en-US-AndrewNeural";

export interface AgentModelOption {
  id: string;
  label: string;
  provider: string;
}

export interface HomeAgentConfig {
  key: string;
  name: string;
  role: string;
  prompt: string;
  defaultProvider: "claude" | "codex";
  defaultModel: string;
  isCustomized: boolean;
}

export interface DemoPersona {
  name: string;
  email?: string;
  username?: string;
  password?: string;
}

export interface GitStatus {
  initialized: boolean;
  has_remote: boolean;
  remote_url: string;
  has_changes: boolean;
  uncommitted_count: number;
  unpushed_count: number;
  behind_count: number;
  last_commit_message: string;
  last_commit_date: string;
  branch: string;
}

export interface GitPushResult {
  success: boolean;
  message: string;
  commit_hash: string;
}

export interface GitSettings {
  name: string;
  email: string;
  ssh_key: string;
  ssh_key_path: string;
  has_ssh_key: boolean;
}

export type ClaudeStatus = "running" | "waiting_approval" | "completed" | "failed" | "stopped" | "idle" | null;
export type ClaudeMode = "auto" | "interactive";
export type WorktreeStatus = "preparing" | "ready" | "failed" | null;
export type DemoStatus = "generating" | "recording" | "completed" | "failed" | null;
export type SeedStatus = "generating" | "completed" | "failed" | null;
export type MessageKind = "text" | "reflection" | "ready" | "action" | "walkthrough" | "seed" | "video";

// ── Conversation ────────────────────────────────────────────────────

export interface Conversation {
  id: number;
  app_id: number;
  kind: ConversationKind;
  title: string;
  status: "open" | "closed" | "archived";
  created_by: number | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Message ─────────────────────────────────────────────────────────

export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant" | "system";
  kind: string;
  body_md: string;
  author_user_id: number | null;
  author_name: string | null;
  author_color: string | null;
  created_at: string;
}

// ── Work Item ───────────────────────────────────────────────────────

export interface WorkItem {
  id: number;
  app_id: number;
  primary_conversation_id: number | null;
  title: string;
  summary: string;
  kind: WorkItemKind;
  status: "in_progress" | "done";
  position: number;
  created_by: number | null;
  created_by_name: string | null;
  created_by_color: string | null;
  origin_type: string;
  origin_automation_key: string | null;
  origin_run_id: number | null;
  created_at: string;
  updated_at: string;
}

// ── Work Item Env ───────────────────────────────────────────────────

export interface WorkItemEnv {
  work_item_id: number;
  branch_name: string | null;
  worktree_dir: string | null;
  worktree_status: WorktreeStatus;
  branch_source: "generated" | "imported" | "setup";
  delete_branch_on_remove: number;
  preview_port: number | null;
  preview_pid: number | null;
}

// ── Agent Session ───────────────────────────────────────────────────

export interface AgentSession {
  id: number;
  conversation_id: number;
  provider_id: string;
  external_session_id: string | null;
  status: string | null;
  last_model_id: string | null;
  created_at: string;
}

// ── Artifact ────────────────────────────────────────────────────────

export interface Artifact {
  id: number;
  app_id: number;
  work_item_id: number | null;
  kind: string;
  name: string | null;
  storage_type: "inline" | "file";
  file_path: string | null;
  inline_text: string | null;
  metadata_json: string | null;
  created_at: string;
}

export type AppFileStatus = "uploading" | "available" | "deleted";

export interface AppFile {
  id: number;
  app_id: number;
  original_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  status: AppFileStatus;
  metadata_json: string | null;
  created_at: string;
  deleted_at: string | null;
  download_url: string;
}

export type MessageAttachment = AppFile;

// ── Preview / Claude status ─────────────────────────────────────────

export interface PreviewStatus {
  running: boolean;
  port: number | null;
  url: string | null;
}

export interface ClaudeStatusResponse {
  claude_status: ClaudeStatus;
  claude_log: string;
  claude_mode: ClaudeMode | null;
  claude_pending_prompt: string | null;
  last_error: ConversationErrorDiagnostic | null;
}

export interface ConversationErrorDiagnostic {
  summary: string;
  category: string;
  detail: string | null;
  provider_id: string | null;
  model_id: string | null;
  run_id: number | null;
  updated_at: string | null;
}

// ── Enriched work item (API response shape with flattened env/artifact fields) ──

export type EnrichedWorkItem = WorkItem & {
  claude_status: ClaudeStatus;
  branch_name: string | null;
  worktree_dir: string | null;
  worktree_status: WorktreeStatus;
  branch_source: "generated" | "imported" | "setup";
  delete_branch_on_remove: number;
  preview_port: number | null;
  preview_pid: number | null;
  description: string;
  pr_url: string | null;
  pr_number: number | null;
  demo_status: DemoStatus;
  demo_video_path: string | null;
  demo_error: string | null;
  demo_seed_script: string | null;
  demo_seed_status: SeedStatus;
  demo_personas: string | null;
  demo_script: string | null;
  demo_seed_output: string | null;
  walkthrough_script: string | null;
  task_type: string | null;
};

/** Alias kept for widespread usage */
export type Task = EnrichedWorkItem;

/** Conversation message as returned by the API */
export interface ConversationMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  message_type: string;
  created_by_name: string | null;
  created_by_color: string | null;
  sender_label: string | null;
  created_at: string;
  attachments?: MessageAttachment[];
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ChatStatus {
  status: "running" | "idle" | null;
  pid: number | null;
}

// ── Home Rooms / Plans ─────────────────────────────────────────────

export type HomeRoomStatus = "open" | "archived";
export type RoomMessageRole = "user" | "agent" | "system";
export type RoomMessageKind = "message" | "decision" | "plan_update" | "execution_event" | "error";
export type PlanStatus = "draft" | "ready" | "executing" | "completed" | "blocked" | "cancelled";
export type PlanExecutionState = "idle" | "running" | "paused" | "completed";
export type PlanStepRiskLevel = "low" | "medium" | "high";
export type PlanStepStatus = "pending" | "implementing" | "reviewing" | "fixing" | "validating" | "committing" | "completed" | "blocked" | "failed" | "skipped";

export interface HomeRoom {
  id: number;
  app_id: number;
  title: string;
  purpose: string;
  planning_context_md: string;
  planning_context_updated_at: string | null;
  status: HomeRoomStatus;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface RoomMessage {
  id: number;
  room_id: number;
  author_user_id: number | null;
  created_by_name: string | null;
  created_by_color: string | null;
  agent_key: string | null;
  role: RoomMessageRole;
  kind: RoomMessageKind;
  body_md: string;
  payload_json: string | null;
  created_at: string;
  attachments?: MessageAttachment[];
}

export interface Plan {
  id: number;
  room_id: number;
  title: string;
  summary_md: string;
  status: PlanStatus;
  execution_state: PlanExecutionState;
  execution_started_at: string | null;
  execution_paused_at: string | null;
  execution_paused_ms: number;
  execution_elapsed_ms: number;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface PlanStep {
  id: number;
  plan_id: number;
  position: number;
  title: string;
  objective_md: string;
  implementation_prompt_md: string;
  acceptance_criteria_md: string;
  risk_level: PlanStepRiskLevel;
  requires_architecture_review: number;
  requires_security_review: number;
  status: PlanStepStatus;
  linked_work_item_id: number | null;
  linked_conversation_id: number | null;
  fix_attempts: number;
  base_commit_sha: string | null;
  commit_sha: string | null;
  result_summary_md: string;
  created_at: string;
  updated_at: string;
  events?: PlanStepEvent[];
}

export interface PlanStepEvent {
  id: number;
  plan_step_id: number;
  phase: string;
  agent_key: string | null;
  status: string;
  summary_md: string;
  payload_json: string | null;
  created_at: string;
}

export interface RoomPlanResponse {
  plan: Plan | null;
  steps: PlanStep[];
  planning_context_md: string;
  planning_context_updated_at: string | null;
}

export interface PlanExecutionResponse {
  plan: Plan;
  step: PlanStep;
  conversation: Conversation;
  work_item: Task;
}

export interface PlanStepGateResponse {
  plan: Plan;
  step: PlanStep;
  events: PlanStepEvent[];
}

// ── Notification (RFC 23) ──────────────────────────────────────────

export interface Notification {
  id: number;
  app_id: number;
  app_name?: string;
  kind: string;
  status: "unread" | "read";
  title: string;
  summary_md: string;
  recipient_user_id: number | null;
  subject_user_id: number | null;
  related_conversation_id: number | null;
  related_work_item_id: number | null;
  automation_key: string | null;
  automation_run_id: number | null;
  metadata_json: string | null;
  read_at: string | null;
  created_at: string;
}

// ── Global LLM Outcomes ───────────────────────────────────────────

export type OutcomeState = "no_pr" | "pending_pr" | "merged" | "closed_unmerged" | "unknown";
export type OutcomeEvidenceCompleteness = "no_pr_artifact" | "local_pr_artifact" | "github_enriched" | "incomplete";
export type OutcomeQualityBand = "pending" | "strong" | "useful" | "costly_reworked" | "abandoned" | "unknown";
export type OutcomeConfidence = "low" | "medium" | "high";
export type OutcomeAttributionClassification = "agent" | "known_user" | "human" | "unknown";
export type OutcomeAttributionConfidence = "unknown" | "low" | "medium" | "high";
export type OutcomeReviewPressure = "low" | "medium" | "high" | "unknown";
export type OutcomeHumanFollowupType = "none" | "clarification" | "expected_iteration" | "agent_correction" | "unrelated_extension" | "unknown";
export type OutcomeFollowupRelation = "no_relation" | "expected_iteration" | "routine_followup" | "agent_correction" | "regression_fix" | "revert" | "unknown";

export interface OutcomeCommitClassification {
  sha: string;
  classification: "agent_authored" | "agent_coauthored" | "human_authored" | "unknown";
  signals: string[];
  author_login: string | null;
  author_email: string | null;
  committer_login: string | null;
  authored_at: string | null;
}

export interface OutcomeEvidenceAssessment {
  review_pressure: OutcomeReviewPressure;
  comment_categories: {
    clarification: number;
    requested_change: number;
    bug_or_regression: number;
    nit: number;
    approval_or_positive: number;
    other: number;
  };
  human_followup_type: OutcomeHumanFollowupType;
  agent_correction_commit_count: number;
  confidence: OutcomeAttributionConfidence;
  evidence_ids: string[];
  summary: string;
}

export interface OutcomeSnapshotEvidence {
  rules_version: number;
  quality_reason: string;
  deterministic_quality_band?: OutcomeQualityBand | null;
  deterministic_quality_reason?: string | null;
  assessment_quality_reason?: string | null;
  llm_assessment?: OutcomeEvidenceAssessment | null;
  attribution_reason: string;
  changes_requested_count: number;
  correction_burden_inputs: {
    review_comment_count: number;
    changes_requested_count: number;
    human_after_agent_commit_count: number;
    extra_issue_comment_count: number;
  };
  pr_author: {
    login: string | null;
    classification: OutcomeAttributionClassification;
    confidence: OutcomeAttributionConfidence;
  };
  pr_artifact_warnings: string[];
  commit_classifications: OutcomeCommitClassification[];
}

export interface OutcomeFollowupEvidence {
  id: number;
  relation_type: OutcomeFollowupRelation;
  confidence: OutcomeAttributionConfidence;
  deterministic_score: number;
  deterministic_signals: string[];
  summary: string | null;
  followup_pr_number: number;
  followup_pr_url: string | null;
  followup_title: string | null;
  detected_at: string;
}

export interface OutcomeSummaryCounts {
  total_work_items: number;
  total_sessions: number;
  pr_linked_work: number;
  pending_prs: number;
  merged_prs: number;
  closed_unmerged_prs: number;
  no_pr_work: number;
  unknown_outcome: number;
  rows_with_unknown_cost: number;
  unknown_cost_runs: number;
}

export interface OutcomeCostBuckets {
  total_known_cost_usd: number;
  pending_pr_cost_usd: number;
  merged_pr_cost_usd: number;
  closed_unmerged_cost_usd: number;
  no_pr_cost_usd: number;
  unknown_outcome_cost_usd: number;
}

export interface OutcomeRow {
  id: string;
  app_id: number;
  app_name: string;
  app_github_repo: string | null;
  work_item_id: number;
  work_item_title: string;
  work_item_status: string;
  conversation_id: number | null;
  conversation_title: string | null;
  branch_name: string | null;
  provider_id: string | null;
  model_id: string | null;
  session_id: number | null;
  external_session_id: string | null;
  session_status: string | null;
  latest_run_id: number | null;
  latest_run_status: string | null;
  latest_run_workflow_key: string | null;
  run_count: number;
  known_cost_usd: number | null;
  unknown_cost_runs: number;
  pr_number: number | null;
  pr_url: string | null;
  pr_title: string | null;
  pr_state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN" | null;
  outcome_state: OutcomeState;
  evidence_completeness: OutcomeEvidenceCompleteness;
  snapshot_id: number | null;
  quality_band: OutcomeQualityBand | null;
  quality_confidence: OutcomeConfidence | null;
  assessment_id: number | null;
  assessment_status: "completed" | "failed" | null;
  assessment_confidence: OutcomeAttributionConfidence | null;
  assessment_provider_id: string | null;
  assessment_model_id: string | null;
  assessment_summary: string | null;
  assessment_created_at: string | null;
  pr_author_login: string | null;
  pr_author_classification: OutcomeAttributionClassification | null;
  pr_author_confidence: OutcomeAttributionConfidence | null;
  attribution_confidence: OutcomeAttributionConfidence | null;
  snapshot_computed_at: string | null;
  snapshot_evidence: OutcomeSnapshotEvidence | null;
  correction_burden_score: number | null;
  human_commit_count: number | null;
  agent_commit_count: number | null;
  coauthored_commit_count: number | null;
  unknown_commit_count: number | null;
  human_after_agent_commit_count: number | null;
  followup_count: number;
  regression_followup_count: number;
  followup_evidence: OutcomeFollowupEvidence[];
  github_evidence_synced_at: string | null;
  github_issue_comments_count: number | null;
  github_review_comments_count: number | null;
  github_reviews_count: number | null;
  github_commits_count: number | null;
  github_additions: number | null;
  github_deletions: number | null;
  github_changed_files: number | null;
  warnings: string[];
  created_at: string;
  updated_at: string;
}

export interface OutcomesSummaryResponse {
  generated_at: string;
  counts: OutcomeSummaryCounts;
  costs: OutcomeCostBuckets;
  rows: OutcomeRow[];
  filters: {
    apps: { id: number; name: string }[];
    providers: string[];
    models: string[];
    run_statuses: string[];
    outcome_states: OutcomeState[];
  };
  warnings: string[];
}

export interface OutcomesGitHubSyncSettings {
  observation_window_days: number;
  daily_sync_enabled: boolean;
  daily_sync_hour_utc: number;
  sync_user_id: number | null;
  last_scheduled_sync_at: string | null;
}

export interface GitHubOutcomeSyncRun {
  id: number;
  requested_by_user_id: number | null;
  mode: "manual" | "scheduled";
  status: "running" | "completed" | "failed";
  range_start: string | null;
  range_end: string | null;
  scanned_count: number;
  synced_count: number;
  failed_count: number;
  warnings_json: string | null;
  error_text: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface OutcomesGitHubSyncResponse {
  run: GitHubOutcomeSyncRun;
  warnings: string[];
  recomputed_snapshots?: number;
}

export interface OutcomesSnapshotRecomputeResponse {
  recomputed_count: number;
  snapshot_ids: number[];
  generated_at: string;
}

export interface OutcomesAssessmentRunResponse {
  assessed_count: number;
  skipped_count: number;
  failed_count: number;
  assessment_ids: number[];
  recomputed_snapshots: number;
  generated_at: string;
  warnings: string[];
}

export interface OutcomeLearningReportExample {
  app_id: number;
  app_name: string;
  work_item_id: number;
  work_item_title: string;
  conversation_id: number | null;
  provider_id: string | null;
  model_id: string | null;
  outcome_state: OutcomeState;
  quality_band: OutcomeQualityBand | null;
  known_cost_usd: number | null;
  unknown_cost_runs: number;
  pr_number: number | null;
  pr_url: string | null;
  assessment_summary: string | null;
  assessment_confidence: OutcomeAttributionConfidence | null;
  followup_count: number;
  regression_followup_count: number;
  prompt_excerpt: string | null;
  evidence_ids: string[];
}

export interface OutcomeLearningReportInsight {
  id: string;
  title: string;
  summary: string;
  evidence: OutcomeLearningReportExample[];
}

export interface OutcomeLearningReportContent {
  version: number;
  generated_at: string;
  range: {
    start: string | null;
    end: string | null;
    days: number | null;
  };
  counts: {
    total_work_items: number;
    resolved_prs: number;
    merged_prs: number;
    closed_unmerged_prs: number;
    pending_prs_excluded: number;
    no_pr_excluded: number;
    unknown_excluded: number;
    assessed_resolved_prs: number;
    post_merge_followups: number;
    likely_regression_followups: number;
  };
  costs: {
    resolved_known_cost_usd: number;
    merged_known_cost_usd: number;
    costly_rework_known_cost_usd: number;
    unknown_cost_rows: number;
  };
  summary_bullets: string[];
  insights: OutcomeLearningReportInsight[];
  sections: {
    strong_examples: OutcomeLearningReportExample[];
    costly_rework_examples: OutcomeLearningReportExample[];
    clarification_examples: OutcomeLearningReportExample[];
    post_merge_fix_examples: OutcomeLearningReportExample[];
    abandoned_examples: OutcomeLearningReportExample[];
    low_confidence_examples: OutcomeLearningReportExample[];
  };
  warnings: string[];
}

export interface OutcomeLearningReportRun {
  id: number;
  requested_by_user_id: number | null;
  mode: "manual" | "scheduled";
  status: "completed" | "failed";
  range_start: string | null;
  range_end: string | null;
  range_days: number | null;
  total_work_items: number;
  resolved_pr_count: number;
  report: OutcomeLearningReportContent | null;
  warnings: string[];
  error_text: string | null;
  generated_at: string;
  created_at: string;
}

export interface OutcomesLearningReportResponse {
  report: OutcomeLearningReportRun | null;
}

export interface OutcomesLearningReportRunResponse {
  report: OutcomeLearningReportRun;
}

export interface OutcomesFollowupDetectionResponse {
  scanned_source_prs: number;
  indexed_repo_prs: number;
  candidate_count: number;
  detected_count: number;
  regression_count: number;
  followup_ids: number[];
  generated_at: string;
  warnings: string[];
}
