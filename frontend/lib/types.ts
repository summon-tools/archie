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
  created_at: string;
  updated_at: string;
}

// ── Work Item Env ───────────────────────────────────────────────────

export interface WorkItemEnv {
  work_item_id: number;
  branch_name: string | null;
  worktree_dir: string | null;
  worktree_status: WorktreeStatus;
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
}

// ── Enriched work item (API response shape with flattened env/artifact fields) ──

export type EnrichedWorkItem = WorkItem & {
  claude_status: ClaudeStatus;
  branch_name: string | null;
  worktree_dir: string | null;
  worktree_status: WorktreeStatus;
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
  created_at: string;
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
export type PlanStepRiskLevel = "low" | "medium" | "high";
export type PlanStepStatus = "pending" | "implementing" | "reviewing" | "fixing" | "validating" | "committing" | "completed" | "blocked" | "failed" | "skipped";

export interface HomeRoom {
  id: number;
  app_id: number;
  title: string;
  purpose: string;
  status: HomeRoomStatus;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface RoomMessage {
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

export interface Plan {
  id: number;
  room_id: number;
  title: string;
  summary_md: string;
  status: PlanStatus;
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
  requires_browser_validation: number;
  status: PlanStepStatus;
  linked_work_item_id: number | null;
  linked_conversation_id: number | null;
  commit_sha: string | null;
  result_summary_md: string;
  created_at: string;
  updated_at: string;
}

export interface RoomPlanResponse {
  plan: Plan | null;
  steps: PlanStep[];
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
