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

export interface WorkItemEnvRow {
  work_item_id: number;
  branch_name: string | null;
  worktree_dir: string | null;
  worktree_status: WorktreeStatus;
  preview_port: number | null;
  preview_pid: number | null;
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

export interface AppToolConfigRow {
  app_id: number;
  tool_key: string;
  config_json: string;
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
