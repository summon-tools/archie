// Server-side row types for the conversation schema

export type ConversationKind = "task" | "chat" | "conversation";
export type ConversationStatus = "open" | "closed" | "archived";
export type WorkItemKind = "task" | "setup";
export type WorkItemStatus = "proposed" | "in_progress" | "done";
export type WorktreeStatus = "preparing" | "ready" | "failed" | null;
export type RunStatus = "running" | "completed" | "failed" | "stopped";
export type ClaudeStatus = "running" | "waiting_approval" | "completed" | "failed" | "stopped" | "idle" | null;
export type ClaudeMode = "auto" | "interactive";
export type DemoStatus = "generating" | "recording" | "completed" | "failed" | null;
export type MessageKind = "text" | "reflection" | "ready" | "action" | "walkthrough" | "seed" | "video";
export type UserRole = "admin" | "member";

export type NotificationStatus = "unread" | "read";
export interface ConversationRow {
  id: number;
  app_id: number;
  kind: ConversationKind;
  title: string;
  status: ConversationStatus;
  created_by: number | null;
  last_message_at: string | null;
  origin_type: string;
  origin_automation_key: string | null;
  origin_run_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  seq: number;
  role: "user" | "assistant" | "system";
  kind: string;
  author_user_id: number | null;
  body_md: string;
  payload_json: string | null;
  model_id: string | null;
  provider_id: string | null;
  created_at: string;
}

export interface WorkItemRow {
  id: number;
  app_id: number;
  primary_conversation_id: number | null;
  title: string;
  summary: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
  position: number;
  created_by: number | null;
  assigned_to: number | null;
  legacy_task_id: number | null;
  completed_at: string | null;
  completed_by_user_id: number | null;
  origin_type: string;
  origin_automation_key: string | null;
  origin_run_id: number | null;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "todo" | "in_progress" | "done";

export interface TaskRow {
  id: number;
  app_id: number;
  title: string;
  description: string;
  status: TaskStatus;
  position: number;
  created_by: number | null;
  assigned_to: number | null;
  origin_type: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskWorkItemRow {
  task_id: number;
  work_item_id: number;
  relation_type: string;
  work_item_title: string;
  work_item_status: WorkItemStatus;
  primary_conversation_id: number | null;
  branch_name: string | null;
  pr_url: string | null;
  pr_number: number | null;
  created_at: string;
}

export interface WorkItemEnvRow {
  work_item_id: number;
  branch_name: string | null;
  worktree_dir: string | null;
  worktree_status: WorktreeStatus;
  branch_source: "generated" | "imported" | "setup";
  delete_branch_on_remove: number;
  preview_port: number | null;
  preview_pid: number | null;
}

export interface GitHubUserConnectionRow {
  user_id: number;
  github_user_id: number;
  github_login: string;
  github_name: string | null;
  github_email: string | null;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  connected_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export type GitHubInstallationState = "active" | "suspended" | "deleted";

export interface GitHubInstallationRow {
  id: number;
  installation_id: number;
  account_login: string;
  account_type: string | null;
  repository_selection: string | null;
  state: GitHubInstallationState;
  raw_json: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectRepositoryState = "active" | "paused";

export interface ProjectRepositoryRow {
  id: number;
  app_id: number;
  app_name: string;
  installation_id: number;
  owner: string;
  repo: string;
  default_branch: string;
  state: ProjectRepositoryState;
  raw_json: string | null;
  created_at: string;
  updated_at: string;
}

export type PullRequestReviewStatus = "queued" | "running" | "completed" | "failed" | "not_supported";
export type PullRequestReviewExecutionMode = "isolated_worktree" | "api_only";

export interface PullRequestReviewRow {
  id: number;
  app_id: number;
  installation_id: number;
  owner: string;
  repo: string;
  pr_number: number;
  action: string;
  base_sha: string | null;
  head_sha: string | null;
  comparison_sha: string | null;
  requested_reviewer_login: string | null;
  status: PullRequestReviewStatus;
  execution_mode: PullRequestReviewExecutionMode;
  workspace_path: string | null;
  execution_json: string;
  context_sources_json: string;
  policy_revision: string | null;
  model_usage_json: string | null;
  pr_url: string | null;
  pr_title: string | null;
  pr_body: string | null;
  context_packet_json: string;
  publication_json: string;
  github_review_id: number | null;
  provider_id: string | null;
  model_id: string | null;
  review_mode: "targeted" | "full";
  previous_review_id: number | null;
  completed_at: string | null;
  error_text: string | null;
  trigger_delivery_id: string;
  created_at: string;
  updated_at: string;
}

export interface PullRequestReviewSummaryRow extends PullRequestReviewRow {
  app_name: string;
  findings_count: number;
  review_run_count: number;
}

export type ReviewPolicyState = "active" | "archived";

export interface ReviewPolicyRow {
  id: number;
  app_id: number;
  owner: string | null;
  repo: string | null;
  revision: string;
  policy_json: string;
  state: ReviewPolicyState;
  created_at: string;
}

export type ProjectDependencyState = "active" | "paused";

export interface ProjectDependencyRow {
  id: number;
  consumer_app_id: number;
  provider_app_id: number;
  relationship_type: string;
  authoritative_ref: string;
  contract_type: string;
  source_path: string;
  version_expectation: string | null;
  state: ProjectDependencyState;
  created_at: string;
  updated_at: string;
  provider_name?: string;
  provider_directory?: string;
  provider_github_repo?: string;
}

export type ContractSnapshotStatus = "ready" | "fetching" | "failed";

export interface ContractSnapshotRow {
  id: number;
  dependency_id: number;
  source_revision: string;
  source_path: string;
  normalized_json: string | null;
  status: ContractSnapshotStatus;
  error_text: string | null;
  fetched_at: string;
}

export type ReviewFindingStatus = "proposed" | "published" | "accepted" | "fixed" | "dismissed" | "obsolete" | "unresolved";

export interface ReviewFindingRow {
  id: number;
  review_id: number;
  fingerprint: string;
  path: string;
  line: number;
  end_line: number | null;
  side: "LEFT" | "RIGHT";
  start_side: "LEFT" | "RIGHT" | null;
  title: string;
  body: string;
  severity: string;
  evidence_json: string;
  status: ReviewFindingStatus;
  github_comment_id: number | null;
  github_comment_url: string | null;
  resolution_json: string | null;
  created_at: string;
  updated_at: string;
}

export type ReviewThreadInteractionStatus = "queued" | "completed" | "failed" | "ignored";

export interface ReviewThreadInteractionRow {
  id: number;
  review_id: number;
  github_comment_id: number;
  author_login: string | null;
  mention_text: string;
  response_body: string | null;
  disposition: string | null;
  status: ReviewThreadInteractionStatus;
  raw_json: string | null;
  processing_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export type GitHubWebhookEventStatus = "received" | "ignored" | "queued" | "failed";

export interface GitHubWebhookEventRow {
  id: number;
  delivery_id: string;
  event_name: string;
  action: string | null;
  installation_id: number | null;
  owner: string | null;
  repo: string | null;
  head_sha: string | null;
  status: GitHubWebhookEventStatus;
  review_id: number | null;
  error_text: string | null;
  payload_json: string;
  received_at: string;
  processed_at: string | null;
}

export interface AgentSessionRow {
  id: number;
  conversation_id: number;
  provider_id: string;
  external_session_id: string | null;
  status: string | null;
  last_model_id: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: number;
  app_id: number;
  conversation_id: number | null;
  work_item_id: number | null;
  session_id: number | null;
  workflow_key: string | null;
  status: RunStatus;
  provider_id: string;
  model_id: string | null;
  input_json: string | null;
  state_json: string | null;
  result_json: string | null;
  error_text: string | null;
  budget_json: string | null;
  failure_category: string | null;
  heartbeat_at: string | null;
  progress_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactRow {
  id: number;
  app_id: number;
  work_item_id: number | null;
  run_id: number | null;
  kind: string;
  name: string | null;
  storage_type: "inline" | "file";
  file_path: string | null;
  inline_text: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface GitHubPrSnapshotRow {
  id: number;
  app_id: number;
  work_item_id: number;
  owner: string;
  repo: string;
  pr_number: number;
  pr_url: string;
  title: string;
  state: string;
  author_login: string | null;
  head_ref: string | null;
  base_ref: string | null;
  merged_at: string | null;
  closed_at: string | null;
  github_created_at: string | null;
  github_updated_at: string | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  commits_count: number | null;
  issue_comments_count: number | null;
  review_comments_count: number | null;
  reviews_count: number | null;
  raw_json: string | null;
  synced_at: string;
  created_at: string;
}

export interface GitHubPrCommentRow {
  id: number;
  pr_snapshot_id: number;
  app_id: number;
  work_item_id: number;
  github_id: number;
  comment_type: "issue" | "review";
  author_login: string | null;
  body: string;
  path: string | null;
  commit_id: string | null;
  github_created_at: string | null;
  github_updated_at: string | null;
  raw_json: string | null;
  synced_at: string;
}

export interface GitHubPrReviewRow {
  id: number;
  pr_snapshot_id: number;
  app_id: number;
  work_item_id: number;
  github_id: number;
  author_login: string | null;
  state: string | null;
  body: string;
  submitted_at: string | null;
  raw_json: string | null;
  synced_at: string;
}

export interface GitHubPrCommitRow {
  id: number;
  pr_snapshot_id: number;
  app_id: number;
  work_item_id: number;
  sha: string;
  author_login: string | null;
  author_name: string | null;
  author_email: string | null;
  committer_login: string | null;
  message: string;
  authored_at: string | null;
  committed_at: string | null;
  raw_json: string | null;
  synced_at: string;
}

export interface GitHubOutcomeSyncRunRow {
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

export type LlmOutcomeState = "no_pr" | "pending_pr" | "merged" | "closed_unmerged" | "unknown";
export type LlmOutcomeQualityBand = "pending" | "strong" | "useful" | "costly_reworked" | "abandoned" | "unknown";
export type LlmOutcomeConfidence = "low" | "medium" | "high";
export type LlmAttributionClassification = "agent" | "known_user" | "human" | "unknown";
export type LlmAttributionConfidence = "unknown" | "low" | "medium" | "high";
export type LlmOutcomeFollowupRelation = "no_relation" | "expected_iteration" | "routine_followup" | "agent_correction" | "regression_fix" | "revert" | "unknown";

export interface LlmOutcomeSnapshotRow {
  id: number;
  app_id: number;
  work_item_id: number;
  conversation_id: number | null;
  session_id: number | null;
  pr_snapshot_id: number | null;
  assessment_id: number | null;
  pr_author_login: string | null;
  pr_author_classification: LlmAttributionClassification;
  pr_author_confidence: LlmAttributionConfidence;
  attribution_confidence: LlmAttributionConfidence;
  outcome_state: LlmOutcomeState;
  quality_band: LlmOutcomeQualityBand;
  confidence: LlmOutcomeConfidence;
  known_cost_usd: number | null;
  unknown_cost_runs: number;
  issue_comment_count: number;
  review_comment_count: number;
  review_count: number;
  commit_count: number;
  human_commit_count: number;
  agent_commit_count: number;
  coauthored_commit_count: number;
  unknown_commit_count: number;
  human_after_agent_commit_count: number;
  correction_burden_score: number;
  evidence_json: string | null;
  computed_at: string;
  created_at: string;
}

export interface LlmOutcomeAssessmentRow {
  id: number;
  app_id: number;
  work_item_id: number;
  snapshot_id: number;
  pr_snapshot_id: number | null;
  provider_id: string;
  model_id: string;
  input_hash: string;
  status: "completed" | "failed";
  assessment_json: string | null;
  confidence: LlmAttributionConfidence;
  error_text: string | null;
  created_at: string;
}

export type LlmOutcomeJobKind = "outcome_refresh" | "github_sync" | "snapshot_recompute" | "evidence_assessment" | "followup_detection";
export type LlmOutcomeJobStatus = "queued" | "running" | "completed" | "failed";

export interface LlmOutcomeJobRow {
  id: number;
  kind: LlmOutcomeJobKind;
  requested_by_user_id: number | null;
  status: LlmOutcomeJobStatus;
  input_json: string | null;
  result_json: string | null;
  progress_text: string | null;
  error_text: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface GitHubRepoPullRequestRow {
  id: number;
  owner: string;
  repo: string;
  pr_number: number;
  pr_url: string;
  title: string;
  body: string;
  state: string;
  author_login: string | null;
  head_ref: string | null;
  base_ref: string | null;
  merged_at: string | null;
  closed_at: string | null;
  github_created_at: string | null;
  github_updated_at: string | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  raw_json: string | null;
  synced_at: string;
  created_at: string;
}

export interface GitHubRepoPullRequestFileRow {
  id: number;
  repo_pr_id: number;
  owner: string;
  repo: string;
  pr_number: number;
  filename: string;
  status: string | null;
  additions: number | null;
  deletions: number | null;
  changes: number | null;
  raw_json: string | null;
  synced_at: string;
}

export interface LlmOutcomeFollowupRow {
  id: number;
  app_id: number;
  source_work_item_id: number;
  source_snapshot_id: number;
  source_pr_snapshot_id: number;
  followup_repo_pr_id: number;
  owner: string;
  repo: string;
  source_pr_number: number;
  followup_pr_number: number;
  relation_type: LlmOutcomeFollowupRelation;
  confidence: LlmAttributionConfidence;
  deterministic_score: number;
  deterministic_signals_json: string | null;
  assessment_json: string | null;
  evidence_json: string | null;
  detected_at: string;
  created_at: string;
}

export type AppFileStatus = "uploading" | "available" | "deleted";
export type AppFileLinkType = "attachment" | "context";

export interface AppFileRow {
  id: number;
  app_id: number;
  uploaded_by_user_id: number | null;
  original_name: string;
  stored_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  status: AppFileStatus;
  metadata_json: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface AppFileLinkRow {
  id: number;
  app_id: number;
  app_file_id: number;
  conversation_id: number | null;
  message_id: number | null;
  work_item_id: number | null;
  link_type: AppFileLinkType;
  created_at: string;
}

export interface AppToolConfigRow {
  app_id: number;
  tool_key: string;
  config_json: string;
}

export interface GlobalSkillRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  body_md: string;
  parts_json: string;
  trigger_phrases_json: string;
  enabled: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface AppRow {
  id: number;
  name: string;
  port: number;
  description: string;
  directory: string;
  github_repo: string;
  project_owner_user_id: number | null;
  created_at: string;
}

export interface AppDependencyRow {
  id: number;
  app_id: number;
  dependency_app_id: number;
  role: string;
  purpose: string;
  dependency_name: string;
  dependency_description: string;
  dependency_directory: string;
  dependency_github_repo: string;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: number;
  username: string;
  name: string;
  password_hash: string;
  role: UserRole;
  email: string | null;
  color: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface InvitationRow {
  id: number;
  email: string;
  token: string;
  invited_by: number;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface SystemSettingRow {
  key: string;
  value_json: string;
}

export interface McpTokenRow {
  id: number;
  name: string;
  token_hash: string;
  token_prefix: string;
  created_by_user_id: number | null;
  scopes_json: string;
  allowed_app_ids_json: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface McpAuditEventRow {
  id: number;
  token_id: number | null;
  app_id: number | null;
  tool_name: string;
  input_summary_json: string | null;
  result_summary_json: string | null;
  status: "success" | "error";
  error_text: string | null;
  duration_ms: number | null;
  created_at: string;
}

// ── Response types used by API routes ──────────────────────────────

export interface WorkItemCounts {
  in_progress: number;
  done: number;
}

export interface ConversationStats {
  total: number;
  open: number;
  previews_running: number;
}

export interface NotificationRow {
  id: number;
  app_id: number;
  kind: string;
  status: NotificationStatus;
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

export interface AutomationConfigRow {
  app_id: number;
  automation_key: string;
  enabled: number; // SQLite boolean: 0 | 1
  cron_expression: string | null;
  config_json: string;
  last_run_at: string | null;
  updated_at: string;
}

export interface AppResponse {
  id: number;
  name: string;
  port: number;
  description: string;
  directory: string;
  github_repo: string;
  project_owner_user_id: number | null;
  is_running: boolean;
  work_item_counts: WorkItemCounts;
  conversation_stats: ConversationStats;
  seed_script: string | null;
  created_at: string;
}
