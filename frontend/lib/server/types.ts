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
export type HomeRoomStatus = "open" | "archived";
export type RoomMessageRole = "user" | "agent" | "system";
export type RoomMessageKind = "message" | "decision" | "plan_update" | "execution_event" | "error";
export type RoomAgentRunPhase = "planning" | "critique" | "coordination" | "review" | "security" | "qa";
export type PlanStatus = "draft" | "ready" | "executing" | "completed" | "blocked" | "cancelled";
export type PlanExecutionState = "idle" | "running" | "paused" | "completed";
export type PlanStepRiskLevel = "low" | "medium" | "high";
export type PlanStepStatus = "pending" | "implementing" | "reviewing" | "fixing" | "validating" | "committing" | "completed" | "blocked" | "failed" | "skipped";

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

export interface WorkItemEnvRow {
  work_item_id: number;
  branch_name: string | null;
  worktree_dir: string | null;
  worktree_status: WorktreeStatus;
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
  room_id: number | null;
  room_message_id: number | null;
  conversation_id: number | null;
  message_id: number | null;
  work_item_id: number | null;
  plan_step_id: number | null;
  link_type: AppFileLinkType;
  created_at: string;
}

export interface AppToolConfigRow {
  app_id: number;
  tool_key: string;
  config_json: string;
}

export interface HomeAgentConfigRow {
  agent_key: string;
  role: string;
  prompt: string;
  provider_id: string;
  model_id: string;
  updated_at: string;
}

export interface HomeRoomRow {
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

export interface RoomMessageRow {
  id: number;
  room_id: number;
  author_user_id: number | null;
  agent_key: string | null;
  role: RoomMessageRole;
  kind: RoomMessageKind;
  body_md: string;
  payload_json: string | null;
  created_at: string;
}

export interface RoomAgentRunRow {
  id: number;
  room_id: number;
  agent_key: string;
  provider_id: string;
  model_id: string | null;
  phase: RoomAgentRunPhase;
  tool_policy_json: string;
  status: RunStatus;
  input_json: string | null;
  result_json: string | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanRow {
  id: number;
  room_id: number;
  title: string;
  summary_md: string;
  status: PlanStatus;
  execution_state: PlanExecutionState;
  execution_started_at: string | null;
  execution_paused_at: string | null;
  execution_paused_ms: number;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface PlanStepRow {
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
}

export interface PlanStepEventRow {
  id: number;
  plan_step_id: number;
  phase: string;
  agent_key: string | null;
  status: string;
  summary_md: string;
  payload_json: string | null;
  created_at: string;
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

// ── Response types used by API routes ──────────────────────────────

export interface WorkItemCounts {
  in_progress: number;
  done: number;
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
  seed_script: string | null;
  created_at: string;
}
