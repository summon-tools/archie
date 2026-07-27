import { App, AppFile, Task, ClaudeStatusResponse, ClaudeMode, GitStatus, GitPushResult, GitSettings, PreviewStatus, ChatMessage, ChatStatus, ConversationMessage, DemoStatus, DemoPersona, WorkItem, WorkItemEnv, Conversation, Message, Artifact, HomeRoom, RoomMessage, RoomPlanResponse, PlanStep, PlanExecutionResponse, PlanStepGateResponse, HomeAgentConfig, AgentModelOption, GlobalSkill, GlobalSkillPart, GlobalSkillSummary, McpToken, OutcomesSummaryResponse, OutcomesGitHubSyncSettings, OutcomesJobEnqueueResponse, OutcomesJobStatusResponse } from "./types";

const BASE = "/api";

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- Setup endpoints ---

export interface SetupStatus {
  needs_setup: boolean;
  mode: string;
  default_projects_dir: string;
  git_name: string;
  git_email: string;
  has_ssh_key: boolean;
  ssh_public_key: string;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch(`${BASE}/setup/status`);
  if (!res.ok) throw new Error("Failed to check setup status");
  return res.json();
}

export async function completeSetup(data: {
  name: string;
  email?: string;
  password?: string;
  projects_dir: string;
  git_name: string;
  git_email: string;
  generate_ssh_key: boolean;
}): Promise<{ message: string; name: string; ssh_public_key: string }> {
  const res = await fetch(`${BASE}/setup/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- App management ---

export async function createApp(
  data: { name: string; description: string }
): Promise<{ app: App; work_item_id: number }> {
  return fetchJSON(`${BASE}/apps`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function importApp(
  data: { github_url?: string; local_path?: string; description?: string }
): Promise<{ app: App; work_item_id: number }> {
  return fetchJSON(`${BASE}/apps/import`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getApps(): Promise<App[]> {
  const data = await fetchJSON<{ apps: App[] }>(`${BASE}/apps`);
  return data.apps;
}

export async function getApp(id: number): Promise<App> {
  return fetchJSON<App>(`${BASE}/apps/${id}`);
}

export async function updateApp(
  id: number,
  fields: { description?: string }
): Promise<App> {
  return fetchJSON<App>(`${BASE}/apps/${id}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

export async function startApp(appId: number): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/start`, { method: "POST" });
}

export async function stopApp(appId: number): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/stop`, { method: "POST" });
}

export async function restartApp(appId: number): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/restart`, { method: "POST" });
}

export async function deleteApp(appId: number, deleteFiles = false): Promise<{ success: boolean; message: string; files_deleted: boolean }> {
  return fetchJSON(`${BASE}/apps/${appId}?delete_files=${deleteFiles}`, { method: "DELETE" });
}

// --- Global outcomes ---

export interface OutcomesSummaryQuery {
  include_rows?: boolean;
  page?: number;
  page_size?: number;
  no_pr_page?: number;
  pending_pr_page?: number;
  merged_page?: number;
  closed_unmerged_page?: number;
  unknown_page?: number;
  app_id?: string;
  outcome_state?: string;
  provider?: string;
  model?: string;
  run_status?: string;
  pr_state?: string;
}

export async function getOutcomesSummary(query: OutcomesSummaryQuery = {}): Promise<OutcomesSummaryResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === "all") continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetchJSON(`${BASE}/outcomes/summary${suffix}`);
}

export async function getOutcomesSettings(): Promise<OutcomesGitHubSyncSettings> {
  const data = await fetchJSON<{ settings: OutcomesGitHubSyncSettings }>(`${BASE}/outcomes/settings`);
  return data.settings;
}

export async function updateOutcomesSettings(data: {
  observation_window_days?: number;
  daily_sync_enabled?: boolean;
  daily_sync_hour_utc?: number;
}): Promise<OutcomesGitHubSyncSettings> {
  const response = await fetchJSON<{ settings: OutcomesGitHubSyncSettings }>(`${BASE}/outcomes/settings`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return response.settings;
}

export async function runOutcomesRefresh(data: {
  full_refresh?: boolean;
  range_days?: number;
  range_start?: string;
  range_end?: string;
} = {}): Promise<OutcomesJobEnqueueResponse> {
  return fetchJSON(`${BASE}/outcomes/refresh/run`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function syncOutcomesGitHubEvidence(data: {
  range_days?: number;
  range_start?: string;
  range_end?: string;
}): Promise<OutcomesJobEnqueueResponse> {
  return fetchJSON(`${BASE}/outcomes/github/sync`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function recomputeOutcomeSnapshots(data: {
  work_item_ids?: number[];
  range_days?: number;
  range_start?: string;
  range_end?: string;
} = {}): Promise<OutcomesJobEnqueueResponse> {
  return fetchJSON(`${BASE}/outcomes/snapshots/recompute`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function runOutcomesEvidenceAssessment(data: {
  work_item_ids?: number[];
  range_days?: number;
  range_start?: string;
  range_end?: string;
  max_items?: number;
  force?: boolean;
} = {}): Promise<OutcomesJobEnqueueResponse> {
  return fetchJSON(`${BASE}/outcomes/assessments/run`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function detectOutcomeFollowups(data: {
  range_days?: number;
  range_start?: string;
  range_end?: string;
  observation_days?: number;
  max_candidates?: number;
} = {}): Promise<OutcomesJobEnqueueResponse> {
  return fetchJSON(`${BASE}/outcomes/followups/detect`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getOutcomeJob(jobId: number): Promise<OutcomesJobStatusResponse> {
  return fetchJSON(`${BASE}/outcomes/jobs/${jobId}`);
}

// --- Conversation endpoints ---

export async function getConversation(appId: number, conversationId: number): Promise<Conversation> {
  return fetchJSON(`${BASE}/apps/${appId}/conversations/${conversationId}`);
}

export async function updateConversation(appId: number, conversationId: number, updates: { title?: string; status?: string }): Promise<Conversation> {
  return fetchJSON(`${BASE}/apps/${appId}/conversations/${conversationId}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteConversation(appId: number, conversationId: number): Promise<void> {
  await fetchJSON(`${BASE}/apps/${appId}/conversations/${conversationId}`, { method: "DELETE" });
}

export async function getConversationMessages(appId: number, conversationId: number): Promise<ConversationMessage[]> {
  const data = await fetchJSON<{ messages: ConversationMessage[] }>(`${BASE}/apps/${appId}/conversations/${conversationId}/messages`);
  return data.messages;
}

export async function sendConversationMessage(
  appId: number,
  conversationId: number,
  content: string,
  role: "user" | "assistant" = "user",
  messageType?: string,
  fileIds: number[] = [],
): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, role, message_type: messageType, file_ids: fileIds.length ? fileIds : undefined }),
  });
}

export async function streamConversationMessage(
  appId: number,
  conversationId: number,
  content: string,
  model?: string,
  retry?: boolean,
  provider?: string,
  fileIds: number[] = [],
  effort?: import("@/lib/effort").EffortLevel,
): Promise<Response> {
  const res = await fetch(`${BASE}/apps/${appId}/conversations/${conversationId}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, model, provider, effort, retry: retry || undefined, file_ids: fileIds.length ? fileIds : undefined }),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res;
}

export async function getConversationClaudeStatus(appId: number, conversationId: number): Promise<ClaudeStatusResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/conversations/${conversationId}/status`);
}

export async function stopConversationClaude(appId: number, conversationId: number): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/conversations/${conversationId}/stop`, { method: "POST" });
}

export async function respondConversationClaude(appId: number, conversationId: number, response: string): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/conversations/${conversationId}/respond`, {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

// --- Work Item endpoints ---

export async function getWorkItems(appId: number): Promise<Task[]> {
  const data = await fetchJSON<{ work_items: Task[] }>(`${BASE}/apps/${appId}/work-items`);
  return data.work_items;
}

export async function createWorkItem(appId: number, message: string, taskType?: string, fileIds: number[] = []): Promise<Task> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items`, {
    method: "POST",
    body: JSON.stringify({ message, task_type: taskType, file_ids: fileIds.length ? fileIds : undefined }),
  });
}

export async function importExistingBranch(appId: number, branch: string): Promise<Task> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/import-branch`, {
    method: "POST",
    body: JSON.stringify({ branch }),
  });
}

export interface RemoteBranchesResponse {
  branches: string[];
  checked_out_branches: string[];
}

export async function getRemoteBranches(appId: number): Promise<RemoteBranchesResponse> {
  return fetchJSON<RemoteBranchesResponse>(`${BASE}/apps/${appId}/git/branches`, {
    cache: "no-store",
  });
}

export async function getWorkItem(appId: number, itemId: number): Promise<Task> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}`);
}

export async function updateWorkItem(appId: number, itemId: number, updates: { title?: string; summary?: string; status?: string }): Promise<Task> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteWorkItem(appId: number, itemId: number): Promise<void> {
  await fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}`, { method: "DELETE" });
}

// --- Conversation list & archive ---

export interface ConversationListItem {
  id: number;
  title: string;
  status: string;
  last_message_at: string | null;
  created_at: string;
  work_item_id: number | null;
  work_item_status: string | null;
  work_item_kind: string | null;
  branch_name: string | null;
  pr_url: string | null;
  pr_number: number | null;
}

export async function getConversationList(appId: number): Promise<ConversationListItem[]> {
  return fetchJSON(`${BASE}/apps/${appId}/conversations`);
}

export async function archiveConversation(appId: number, conversationId: number): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/conversations/${conversationId}/archive`, { method: "POST" });
}

export async function markWorkItemDone(appId: number, itemId: number): Promise<Task> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/done`, { method: "POST" });
}

// --- Home Rooms / Plans ---

export async function getRooms(appId: number): Promise<HomeRoom[]> {
  const data = await fetchJSON<{ rooms: HomeRoom[] }>(`${BASE}/apps/${appId}/rooms`);
  return data.rooms;
}

export async function createRoom(appId: number, body: { title: string; purpose?: string; message?: string }): Promise<HomeRoom> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getRoom(appId: number, roomId: number): Promise<HomeRoom> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}`);
}

export async function updateRoom(appId: number, roomId: number, body: Partial<Pick<HomeRoom, "title" | "purpose" | "status">>): Promise<HomeRoom> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function getRoomMessages(appId: number, roomId: number): Promise<RoomMessage[]> {
  const data = await fetchJSON<{ messages: RoomMessage[] }>(`${BASE}/apps/${appId}/rooms/${roomId}/messages`);
  return data.messages;
}

export async function sendRoomMessage(appId: number, roomId: number, content: string, targetAgentKey?: string | null, fileIds: number[] = []): Promise<RoomMessage> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, target_agent_key: targetAgentKey || undefined, file_ids: fileIds.length ? fileIds : undefined }),
  });
}

export async function streamRoomMessage(appId: number, roomId: number, content: string, targetAgentKey?: string | null, fileIds: number[] = []): Promise<Response> {
  const res = await fetch(`${BASE}/apps/${appId}/rooms/${roomId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, target_agent_key: targetAgentKey || undefined, file_ids: fileIds.length ? fileIds : undefined }),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res;
}

export async function getRoomPlan(appId: number, roomId: number): Promise<RoomPlanResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan`);
}

export async function createRoomPlan(appId: number, roomId: number, body: { title: string; summary_md?: string; status?: string }): Promise<RoomPlanResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function generateRoomPlan(appId: number, roomId: number): Promise<RoomPlanResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan/generate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function updateRoomPlan(appId: number, roomId: number, body: { title?: string; summary_md?: string; status?: string; current_version?: number }): Promise<RoomPlanResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function createPlanStep(appId: number, roomId: number, body: Partial<PlanStep> & { title: string }): Promise<PlanStep> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan/steps`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type PlanStepUpdate = Partial<Omit<PlanStep, "requires_architecture_review" | "requires_security_review">> & {
  requires_architecture_review?: boolean;
  requires_security_review?: boolean;
};

export async function updatePlanStep(appId: number, roomId: number, stepId: number, body: PlanStepUpdate): Promise<PlanStep> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan/steps/${stepId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function executeNextPlanStep(appId: number, roomId: number): Promise<PlanExecutionResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan/execute-next`, { method: "POST" });
}

export async function pausePlanExecution(appId: number, roomId: number): Promise<RoomPlanResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan/pause`, { method: "POST" });
}

export async function resumePlanExecution(appId: number, roomId: number): Promise<RoomPlanResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan/resume`, { method: "POST" });
}

export async function startPlanStepGates(appId: number, roomId: number, stepId: number): Promise<PlanStepGateResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan/steps/${stepId}/gates/start`, { method: "POST" });
}

export async function runPlanStepGates(appId: number, roomId: number, stepId: number): Promise<{ status: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan/steps/${stepId}/gates/run`, { method: "POST" });
}

export async function advancePlanStepGate(
  appId: number,
  roomId: number,
  stepId: number,
  body: { status: "passed" | "failed"; summary_md?: string; commit_sha?: string },
): Promise<PlanStepGateResponse> {
  return fetchJSON(`${BASE}/apps/${appId}/rooms/${roomId}/plan/steps/${stepId}/gates/advance`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Work Item Environment endpoints ---

export async function getWorkItemEnv(appId: number, itemId: number): Promise<WorkItemEnv> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env`);
}

export async function createWorktree(appId: number, itemId: number): Promise<{ success: boolean; message: string; branch_name: string; worktree_dir: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/create`, { method: "POST" });
}

export async function startPreview(appId: number, itemId: number): Promise<{ success: boolean; message: string; port: number; pid: number; url: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/preview/start`, { method: "POST" });
}

export async function stopPreview(appId: number, itemId: number): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/preview/stop`, { method: "POST" });
}

export async function restartPreview(appId: number, itemId: number): Promise<{ success: boolean; message: string; port?: number; pid?: number; url?: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/preview/restart`, { method: "POST" });
}

export async function getPreviewStatus(appId: number, itemId: number): Promise<PreviewStatus> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/preview/status`);
}

export async function getWorktreeDiff(appId: number, itemId: number): Promise<{ diff: string; stat: string; files_changed: number }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/diff`);
}

export async function getWorktreeLogs(appId: number, itemId: number, lines?: number): Promise<{ content: string; path: string; size: number }> {
  const query = lines ? `?lines=${lines}` : "";
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/logs${query}`);
}

export async function getWorktreeGitStatus(appId: number, itemId: number): Promise<GitStatus> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/git-status`);
}

export async function pushWorktreeBranch(appId: number, itemId: number): Promise<GitPushResult> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/push`, { method: "POST" });
}

export async function pullWorktreeBranch(appId: number, itemId: number): Promise<{ success: boolean; message: string; branch: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/pull`, { method: "POST" });
}

export async function rebaseWorktreeFromMain(appId: number, itemId: number): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/rebase`, { method: "POST" });
}

export async function createWorktreePR(appId: number, itemId: number): Promise<{ success: boolean; message: string; pr_url: string; pr_number: number }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/create-pr`, { method: "POST" });
}

export async function updateWorktreePR(appId: number, itemId: number): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env/update-pr`, { method: "POST" });
}

export async function removeWorktree(appId: number, itemId: number): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/env`, { method: "DELETE" });
}

// --- Demo / Walkthrough endpoints ---

export async function generateSeed(appId: number, itemId: number, customInstruction?: string): Promise<Response> {
  const res = await fetch(`${BASE}/apps/${appId}/work-items/${itemId}/demo/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customInstruction: customInstruction || undefined }),
  });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("Not authenticated"); }
  if (!res.ok) { const error = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(error.detail || `HTTP ${res.status}`); }
  return res;
}

export async function generateDemoScript(appId: number, itemId: number): Promise<Response> {
  const res = await fetch(`${BASE}/apps/${appId}/work-items/${itemId}/demo/script`, { method: "POST" });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("Not authenticated"); }
  if (!res.ok) { const error = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(error.detail || `HTTP ${res.status}`); }
  return res;
}

export async function generateDemo(appId: number, itemId: number, script: string, voice?: string): Promise<Response> {
  const res = await fetch(`${BASE}/apps/${appId}/work-items/${itemId}/demo/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script, voice }),
  });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("Not authenticated"); }
  if (!res.ok) { const error = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(error.detail || `HTTP ${res.status}`); }
  return res;
}

export async function getDemoStatus(appId: number, itemId: number): Promise<{ demo_status: DemoStatus; demo_video_path: string | null; demo_error: string | null }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/demo/status`);
}

export async function cancelDemo(appId: number, itemId: number): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/demo/cancel`, { method: "POST" });
}

export function getDemoVideoUrl(appId: number, itemId: number): string {
  return `${BASE}/apps/${appId}/work-items/${itemId}/demo/video`;
}

export function getDemoVideoUrlByArtifact(appId: number, artifactId: number): string {
  return `${BASE}/apps/${appId}/artifacts/${artifactId}/video`;
}

export async function getWalkthroughActions(appId: number, itemId: number, opts?: { mode: string; pageSnapshot?: string; currentPath?: string; viewportWidth?: number; viewportHeight?: number }): Promise<{ actions: any[] }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/demo/walkthrough`, {
    method: "POST",
    body: JSON.stringify(opts || { mode: "replay" }),
  });
}

export async function walkthroughStep(appId: number, itemId: number, body: any): Promise<{ actions: any[]; narrationText: string; rawScript: string; done: boolean }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/demo/walkthrough/step`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function saveWalkthroughScript(appId: number, itemId: number, script: string): Promise<void> {
  await fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/demo/walkthrough`, {
    method: "PUT",
    body: JSON.stringify({ script }),
  });
}

export async function appWalkthroughStep(appId: number, body: any): Promise<{ actions: any[]; narrationText: string; rawScript: string; done: boolean }> {
  return fetchJSON(`${BASE}/apps/${appId}/walkthrough/step`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Code walkthrough ---

export interface CodeWalkthroughStep {
  file: string;
  narration: string;
  audioData?: string;
  audioDurationMs?: number;
}

export async function getCodeWalkthroughPlan(appId: number, itemId: number, goal?: string): Promise<{ steps: CodeWalkthroughStep[] }> {
  return fetchJSON(`${BASE}/apps/${appId}/work-items/${itemId}/code-walkthrough/plan`, {
    method: "POST",
    body: JSON.stringify({ goal }),
  });
}

// --- Intent classification ---

export type IntentType = "walkthrough" | "seed" | "video" | "code";

export async function classifyIntent(appId: number, message: string): Promise<IntentType> {
  const data = await fetchJSON<{ intent: IntentType }>(`${BASE}/apps/${appId}/classify-intent`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  return data.intent;
}

// --- Git endpoints ---

export async function getGitSettings(): Promise<GitSettings> {
  return fetchJSON<GitSettings>(`${BASE}/git/settings`);
}

export async function updateGitSettings(name: string, email: string): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/git/settings`, {
    method: "POST",
    body: JSON.stringify({ name, email }),
  });
}

export async function generateSSHKey(): Promise<{ success: boolean; message: string; public_key: string }> {
  return fetchJSON(`${BASE}/git/ssh-key`, { method: "POST" });
}

export interface GitHubAppSettings {
  public_server_url: string;
  callback_suffix: string;
  callback_url: string;
  client_id: string;
  client_secret_configured: boolean;
  app_slug: string;
  install_url: string;
  bot_username: string;
  bot_display_name: string;
  bot_email: string;
}

export interface GitHubConnection {
  connected: boolean;
  github_login?: string;
  github_name?: string | null;
  github_email?: string | null;
  access_token_expires_at?: string | null;
  refresh_token_expires_at?: string | null;
  connected_at?: string;
}

export async function getGitHubAppSettings(): Promise<GitHubAppSettings> {
  return fetchJSON<GitHubAppSettings>(`${BASE}/github/app-settings`);
}

export async function updateGitHubAppSettings(
  data: Partial<GitHubAppSettings> & { client_secret?: string; clear_client_secret?: boolean },
): Promise<GitHubAppSettings> {
  return fetchJSON<GitHubAppSettings>(`${BASE}/github/app-settings`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function getGitHubConnection(): Promise<GitHubConnection> {
  return fetchJSON<GitHubConnection>(`${BASE}/github/connection`);
}

export async function disconnectGitHub(): Promise<GitHubConnection> {
  return fetchJSON<GitHubConnection>(`${BASE}/github/connection`, { method: "DELETE" });
}

export async function getGitStatus(appId: number): Promise<GitStatus> {
  return fetchJSON<GitStatus>(`${BASE}/apps/${appId}/git/status`);
}

export async function initGit(appId: number): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/git/init`, { method: "POST" });
}

export async function setGitRemote(appId: number, repoUrl: string): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/git/set-remote`, {
    method: "POST",
    body: JSON.stringify({ repo_url: repoUrl }),
  });
}

export async function pushToGitHub(appId: number): Promise<GitPushResult> {
  return fetchJSON(`${BASE}/apps/${appId}/git/push`, { method: "POST" });
}

export async function pullFromGitHub(
  appId: number,
  options: { discardLocalChanges?: boolean } = {},
): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/git/pull`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

// --- Environment variable endpoints ---

export interface EnvVar { key: string; value: string; }

export async function getEnvVars(appId: number): Promise<EnvVar[]> {
  const data = await fetchJSON<{ env_vars: EnvVar[] }>(`${BASE}/apps/${appId}/env`);
  return data.env_vars;
}

export async function updateEnvVars(appId: number, envVars: EnvVar[]): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/env`, {
    method: "PUT",
    body: JSON.stringify({ env_vars: envVars }),
  });
}

export async function deleteEnvVar(appId: number, key: string): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/env/${encodeURIComponent(key)}`, { method: "DELETE" });
}

// --- Script content endpoints ---

export interface ScriptContents { start_sh: string | null; stop_sh: string | null; }

export async function getScripts(appId: number): Promise<ScriptContents> {
  return fetchJSON<ScriptContents>(`${BASE}/apps/${appId}/scripts`);
}

// --- App files ---

export async function getAppFiles(appId: number, includeDeleted = false): Promise<AppFile[]> {
  const suffix = includeDeleted ? "?include_deleted=true" : "";
  const data = await fetchJSON<{ files: AppFile[] }>(`${BASE}/apps/${appId}/files${suffix}`);
  return data.files;
}

export async function uploadAppFile(appId: number, file: File): Promise<AppFile> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE}/apps/${appId}/files`, {
    method: "POST",
    body: formData,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  const data = await res.json() as { file: AppFile };
  return data.file;
}

export async function deleteAppFile(appId: number, fileId: number): Promise<AppFile> {
  const data = await fetchJSON<{ file: AppFile }>(`${BASE}/apps/${appId}/files/${fileId}`, {
    method: "DELETE",
  });
  return data.file;
}

// --- User management endpoints ---

export interface MeResponse { id: number; name: string; role: "admin" | "member"; email: string; color: string | null; }

export async function getMe(): Promise<MeResponse> {
  return fetchJSON<MeResponse>(`${BASE}/auth/me`);
}

export interface UserInfo { id: number; name: string; role: "admin" | "member"; email: string | null; color: string | null; deleted_at: string | null; created_at: string; }

export async function getUsers(): Promise<UserInfo[]> {
  const data = await fetchJSON<{ users: UserInfo[] }>(`${BASE}/admin/users`);
  return data.users;
}

export async function updateUserRole(id: number, role: "admin" | "member"): Promise<{ message: string; role: string }> {
  return fetchJSON(`${BASE}/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
}

export async function deleteUser(id: number): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/admin/users/${id}`, { method: "DELETE" });
}

export async function restoreUser(id: number): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ restore: true }) });
}

export async function resetUserPassword(id: number, newPassword: string): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/admin/users/${id}/password`, {
    method: "POST",
    body: JSON.stringify({ new_password: newPassword }),
  });
}

export interface InvitationInfo { id: number; email: string; token: string; invited_by: number; expires_at: string; accepted_at: string | null; created_at: string; }

export async function createInvitation(email: string): Promise<{ id: number; email: string; token: string; expires_at: string }> {
  return fetchJSON(`${BASE}/admin/invitations`, { method: "POST", body: JSON.stringify({ email }) });
}

export async function getInvitations(): Promise<InvitationInfo[]> {
  const data = await fetchJSON<{ invitations: InvitationInfo[] }>(`${BASE}/admin/invitations`);
  return data.invitations;
}

export async function revokeInvitation(id: number): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/admin/invitations/${id}`, { method: "DELETE" });
}

export async function getInviteInfo(token: string): Promise<{ email: string; expires_at: string }> {
  const res = await fetch(`${BASE}/invite/${token}`);
  if (!res.ok) { const error = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(error.detail || `HTTP ${res.status}`); }
  return res.json();
}

export async function acceptInvite(token: string, name: string, password: string): Promise<{ message: string; name: string }> {
  const res = await fetch(`${BASE}/invite/${token}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  if (!res.ok) { const error = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(error.detail || `HTTP ${res.status}`); }
  return res.json();
}

// --- Settings endpoints ---

export interface DashboardSettings {
  settings: Record<string, string>;
  computed: { projects_dir: string; claude_bin: string; home_dir: string; };
}

export async function getSettings(): Promise<DashboardSettings> {
  return fetchJSON<DashboardSettings>(`${BASE}/settings`);
}

// --- App agent config endpoints ---

export interface HomeAgentsResponse {
  agents: HomeAgentConfig[];
  availableModels: AgentModelOption[];
}

export async function getHomeAgents(): Promise<HomeAgentsResponse> {
  return fetchJSON<HomeAgentsResponse>(`${BASE}/settings/agents`);
}

export async function updateHomeAgent(
  agent: { agent_key: string; role: string; prompt: string; model_id: string },
): Promise<HomeAgentsResponse> {
  return fetchJSON<HomeAgentsResponse>(`${BASE}/settings/agents`, {
    method: "PUT",
    body: JSON.stringify(agent),
  });
}

// --- Global skill endpoints ---

export interface GlobalSkillPayload {
  slug: string;
  name: string;
  description: string;
  body_md: string;
  parts: GlobalSkillPart[];
  trigger_phrases: string[];
  enabled: boolean;
}

export async function fetchGlobalSkillSummaries(): Promise<{ skills: GlobalSkillSummary[] }> {
  return fetchJSON<{ skills: GlobalSkillSummary[] }>(`${BASE}/skills`);
}

export async function fetchGlobalSkillsAdmin(): Promise<{ skills: GlobalSkill[] }> {
  return fetchJSON<{ skills: GlobalSkill[] }>(`${BASE}/settings/skills`);
}

export async function createGlobalSkill(payload: GlobalSkillPayload): Promise<{ skill: GlobalSkill }> {
  return fetchJSON<{ skill: GlobalSkill }>(`${BASE}/settings/skills`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateGlobalSkill(slug: string, payload: GlobalSkillPayload): Promise<{ skill: GlobalSkill }> {
  return fetchJSON<{ skill: GlobalSkill }>(`${BASE}/settings/skills/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteGlobalSkill(slug: string): Promise<{ deleted: string }> {
  return fetchJSON<{ deleted: string }>(`${BASE}/settings/skills/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
}

// --- MCP token endpoints ---

export const MCP_SCOPES = [
  "apps:read",
  "skills:read",
  "project:read",
  "tasks:read",
  "tasks:write",
  "tasks:stop",
  "servers:read",
  "servers:start",
  "servers:stop",
  "activity:read",
] as const;

export interface McpTokenPayload {
  name: string;
  scopes: string[];
  allowed_app_ids: number[];
  expires_at?: string | null;
}

export async function fetchMcpTokens(): Promise<{ tokens: McpToken[] }> {
  return fetchJSON<{ tokens: McpToken[] }>(`${BASE}/settings/mcp-tokens`);
}

export async function createMcpToken(payload: McpTokenPayload): Promise<{ token: McpToken; secret: string }> {
  return fetchJSON<{ token: McpToken; secret: string }>(`${BASE}/settings/mcp-tokens`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function revokeMcpToken(id: number): Promise<{ success: boolean }> {
  return fetchJSON<{ success: boolean }>(`${BASE}/settings/mcp-tokens/${id}`, {
    method: "DELETE",
  });
}

export async function deleteMcpToken(id: number): Promise<{ success: boolean }> {
  return fetchJSON<{ success: boolean }>(`${BASE}/settings/mcp-tokens/${id}?hard=1`, {
    method: "DELETE",
  });
}

// --- Model config endpoints ---

export interface ModelConfig {
  chatModel: string;
  chatProvider: string;
  backgroundModel: string;
  backgroundProvider: string;
  quickModel: string;
  quickProvider: string;
  demoModel: string;
  demoProvider: string;
  availableModels: { id: string; label: string; provider: string }[];
  // Legacy compat
  defaultModel?: string;
  defaultProvider?: string;
}

export async function getModelConfig(): Promise<ModelConfig> {
  return fetchJSON<ModelConfig>(`${BASE}/models/config`);
}

export async function updateModelConfig(config: Partial<Omit<ModelConfig, "availableModels">>): Promise<ModelConfig> {
  return fetchJSON(`${BASE}/models/config`, {
    method: "POST",
    body: JSON.stringify(config),
  });
}

// ── Background Jobs ──────────────────────────────────────────────

export interface ActiveJob {
  id: string;
  app_id: number;
  app_name: string;
  type: string;
  label: string;
  progress: string;
  started_at: number;
}

export async function getActiveJobs(appId?: number): Promise<{ jobs: ActiveJob[]; notification_unread_count: number }> {
  const query = appId ? `?app_id=${appId}` : "";
  return fetchJSON(`${BASE}/jobs/active${query}`);
}

// --- Notification endpoints (RFC 23) ---

export interface NotificationItem {
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

export async function getNotifications(status?: string, appId?: number): Promise<{ notifications: NotificationItem[]; unread_count: number }> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (appId) params.set("app_id", String(appId));
  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchJSON(`${BASE}/notifications${query}`);
}

export async function getNotificationCount(): Promise<{ unread_count: number }> {
  return fetchJSON(`${BASE}/notifications/count`);
}

export async function markNotificationRead(id: number): Promise<NotificationItem> {
  return fetchJSON(`${BASE}/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(appId?: number): Promise<{ message: string; unread_count: number }> {
  return fetchJSON(`${BASE}/notifications/read-all`, {
    method: "POST",
    body: JSON.stringify(appId ? { app_id: appId } : {}),
  });
}

// --- Automation endpoints (RFC 23) ---

export interface AutomationConfig {
  key: string;
  name: string;
  description: string;
  defaultCron: string;
  enabled: boolean;
  cronExpression: string;
  lastRunAt: string | null;
}

export async function getAutomationConfigs(appId: number): Promise<{ automations: AutomationConfig[] }> {
  return fetchJSON(`${BASE}/apps/${appId}/automations`);
}

export async function updateAutomationConfig(appId: number, key: string, fields: { enabled?: boolean; cron_expression?: string }): Promise<void> {
  await fetchJSON(`${BASE}/apps/${appId}/automations`, {
    method: "PUT",
    body: JSON.stringify({ key, ...fields }),
  });
}

export async function runAutomationNow(appId: number, key: string): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/automations/run`, {
    method: "POST",
    body: JSON.stringify({ key }),
  });
}

export async function updateProjectOwner(appId: number, userId: number | null): Promise<void> {
  await fetchJSON(`${BASE}/apps/${appId}/automations`, {
    method: "PUT",
    body: JSON.stringify({ project_owner_user_id: userId }),
  });
}

// --- Skills endpoints ---

export interface SkillEntry {
  filename: string;
  name: string;
  description: string;
}

export interface SkillDetail extends SkillEntry {
  content: string;
}

export async function fetchSkills(appId: number): Promise<{ entries: SkillEntry[] }> {
  return fetchJSON(`${BASE}/apps/${appId}/skills`);
}

export async function fetchSkill(appId: number, filename: string): Promise<SkillDetail> {
  return fetchJSON(`${BASE}/apps/${appId}/skills/${encodeURIComponent(filename)}`);
}

export async function saveSkill(appId: number, filename: string, content: string): Promise<SkillEntry> {
  return fetchJSON(`${BASE}/apps/${appId}/skills/${encodeURIComponent(filename)}`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function deleteSkill(appId: number, filename: string): Promise<{ deleted: string }> {
  return fetchJSON(`${BASE}/apps/${appId}/skills/${encodeURIComponent(filename)}`, { method: "DELETE" });
}

export async function generateMainSeed(appId: number, customInstruction?: string): Promise<Response> {
  const res = await fetch(`${BASE}/apps/${appId}/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customInstruction: customInstruction || undefined }),
  });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("Not authenticated"); }
  if (!res.ok) { const error = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(error.detail || `HTTP ${res.status}`); }
  return res;
}

export async function clearAppSeedScript(appId: number): Promise<void> {
  await fetchJSON(`${BASE}/apps/${appId}/seed-script`, { method: "DELETE" });
}


// Chat compat
export async function getChatMessages(appId: number): Promise<ChatMessage[]> {
  const conversations = await fetchJSON<any>(`${BASE}/apps/${appId}/conversations?kind=chat`);
  const list = Array.isArray(conversations) ? conversations : (conversations.conversations || []);
  if (list.length === 0) return [];
  const msgs = await getConversationMessages(appId, list[0].id);
  return msgs.map(m => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, created_at: m.created_at }));
}

export async function sendChatMessage(appId: number, message: string): Promise<{ message: string; pid: number }> {
  const conversations = await fetchJSON<any>(`${BASE}/apps/${appId}/conversations?kind=chat`);
  const list = Array.isArray(conversations) ? conversations : (conversations.conversations || []);
  let conversationId: number;
  if (list.length === 0) {
    const item = await createWorkItem(appId, message);
    conversationId = item.primary_conversation_id!;
  } else {
    conversationId = list[0].id;
  }
  await sendConversationMessage(appId, conversationId, message);
  return { message: "ok", pid: 0 };
}

// --- Terminal sessions ---

export async function listTerminalSessions(appId?: number): Promise<{ sessions: any[] }> {
  const params = appId ? `?appId=${appId}` : "";
  return fetchJSON(`${BASE}/terminals${params}`);
}

export async function createTerminalSession(opts: { appId?: number; workItemId?: number; cwd?: string }): Promise<{ session: any }> {
  return fetchJSON(`${BASE}/terminals`, { method: "POST", body: JSON.stringify(opts) });
}

export async function closeTerminalSession(sessionId: string): Promise<{ message: string }> {
  return fetchJSON(`${BASE}/terminals/${sessionId}`, { method: "DELETE" });
}

export async function getChatStatus(appId: number): Promise<ChatStatus> {
  return { status: null, pid: null };
}

export async function clearChatHistory(appId: number): Promise<{ message: string }> {
  const conversations = await fetchJSON<any>(`${BASE}/apps/${appId}/conversations?kind=chat`);
  const list = Array.isArray(conversations) ? conversations : (conversations.conversations || []);
  for (const c of list) {
    await deleteConversation(appId, c.id);
  }
  return { message: "Chat history cleared" };
}
