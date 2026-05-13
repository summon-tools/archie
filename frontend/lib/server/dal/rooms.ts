import { getDb } from "../db";
import type {
  HomeRoomRow,
  HomeRoomStatus,
  PlanRow,
  PlanStatus,
  PlanStepEventRow,
  PlanStepRiskLevel,
  PlanStepRow,
  PlanStepStatus,
  RoomAgentRunPhase,
  RoomAgentRunRow,
  RoomMessageKind,
  RoomMessageRole,
  RoomMessageRow,
  RunStatus,
} from "../types";

function buildUpdate(
  table: string,
  idColumn: string,
  id: number,
  fields: Record<string, unknown>,
): void {
  const keys = Object.keys(fields).filter((key) => fields[key] !== undefined);
  if (keys.length === 0) return;

  const setParts = keys.map((key) => `${quoteIdentifier(key)} = ?`);
  const values = keys.map((key) => fields[key]);
  setParts.push("updated_at = datetime('now')");
  values.push(id);

  const result = getDb()
    .prepare(`UPDATE ${quoteIdentifier(table)} SET ${setParts.join(", ")} WHERE ${quoteIdentifier(idColumn)} = ?`)
    .run(...values);
  if (result.changes === 0) {
    throw new Error(`${table} row not found: ${id}`);
  }
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function getRoom(roomId: number): HomeRoomRow | undefined {
  return getDb().prepare("SELECT * FROM home_rooms WHERE id = ?").get(roomId) as HomeRoomRow | undefined;
}

export function getRoomsByApp(appId: number): HomeRoomRow[] {
  return getDb().prepare(
    `SELECT * FROM home_rooms
     WHERE app_id = ?
     ORDER BY updated_at DESC, created_at DESC, id DESC`
  ).all(appId) as HomeRoomRow[];
}

export function createRoom(data: {
  app_id: number;
  title: string;
  purpose?: string;
  created_by?: number | null;
}): HomeRoomRow {
  const result = getDb().prepare(
    `INSERT INTO home_rooms (app_id, title, purpose, created_by)
     VALUES (?, ?, ?, ?)`
  ).run(
    data.app_id,
    data.title,
    data.purpose || "",
    data.created_by ?? null,
  );
  return getRoom(Number(result.lastInsertRowid))!;
}

export function updateRoom(
  roomId: number,
  fields: Partial<Pick<HomeRoomRow, "title" | "purpose" | "planning_context_md" | "planning_context_updated_at" | "status">>,
): void {
  buildUpdate("home_rooms", "id", roomId, fields);
}

export function updateRoomPlanningContext(roomId: number, planningContextMd: string): void {
  getDb().prepare(
    `UPDATE home_rooms
     SET planning_context_md = ?,
         planning_context_updated_at = CASE WHEN length(trim(?)) > 0 THEN datetime('now') ELSE NULL END,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    planningContextMd,
    planningContextMd,
    roomId,
  );
}

export function createRoomMessage(data: {
  room_id: number;
  role: RoomMessageRole;
  body_md: string;
  kind?: RoomMessageKind;
  author_user_id?: number | null;
  agent_key?: string | null;
  payload_json?: string | null;
}): RoomMessageRow {
  const db = getDb();
  return db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO room_messages (room_id, author_user_id, agent_key, role, kind, body_md, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.room_id,
      data.author_user_id ?? null,
      data.agent_key ?? null,
      data.role,
      data.kind || "message",
      data.body_md,
      data.payload_json ?? null,
    );
    const update = db.prepare("UPDATE home_rooms SET updated_at = datetime('now') WHERE id = ?").run(data.room_id);
    if (update.changes === 0) {
      throw new Error(`home_rooms row not found: ${data.room_id}`);
    }
    return db.prepare("SELECT * FROM room_messages WHERE id = ?").get(result.lastInsertRowid) as RoomMessageRow;
  })();
}

export function getRoomMessages(roomId: number, limit = 200): RoomMessageRow[] {
  return getDb().prepare(
    `SELECT * FROM room_messages
     WHERE room_id = ?
     ORDER BY id ASC
     LIMIT ?`
  ).all(roomId, limit) as RoomMessageRow[];
}

export function createRoomAgentRun(data: {
  room_id: number;
  agent_key: string;
  provider_id: string;
  phase: RoomAgentRunPhase;
  model_id?: string | null;
  tool_policy_json?: string;
  status?: RunStatus;
  input_json?: string | null;
  result_json?: string | null;
  error_text?: string | null;
}): RoomAgentRunRow {
  const result = getDb().prepare(
    `INSERT INTO room_agent_runs
      (room_id, agent_key, provider_id, model_id, phase, tool_policy_json, status, input_json, result_json, error_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.room_id,
    data.agent_key,
    data.provider_id,
    data.model_id ?? null,
    data.phase,
    data.tool_policy_json || "{}",
    data.status || "running",
    data.input_json ?? null,
    data.result_json ?? null,
    data.error_text ?? null,
  );
  return getDb().prepare("SELECT * FROM room_agent_runs WHERE id = ?").get(result.lastInsertRowid) as RoomAgentRunRow;
}

export function updateRoomAgentRun(
  runId: number,
  fields: Partial<Pick<RoomAgentRunRow, "status" | "result_json" | "error_text" | "model_id" | "tool_policy_json">>,
): void {
  buildUpdate("room_agent_runs", "id", runId, fields);
}

export function getRoomAgentRuns(roomId: number): RoomAgentRunRow[] {
  return getDb().prepare(
    `SELECT * FROM room_agent_runs
     WHERE room_id = ?
     ORDER BY created_at ASC, id ASC`
  ).all(roomId) as RoomAgentRunRow[];
}

export function getPlan(planId: number): PlanRow | undefined {
  return getDb().prepare("SELECT * FROM plans WHERE id = ?").get(planId) as PlanRow | undefined;
}

export function getPlansByRoom(roomId: number): PlanRow[] {
  return getDb().prepare(
    `SELECT * FROM plans
     WHERE room_id = ?
     ORDER BY updated_at DESC, id DESC`
  ).all(roomId) as PlanRow[];
}

export function createPlan(data: {
  room_id: number;
  title: string;
  summary_md?: string;
  status?: PlanStatus;
}): PlanRow {
  const result = getDb().prepare(
    `INSERT INTO plans (room_id, title, summary_md, status)
     VALUES (?, ?, ?, ?)`
  ).run(
    data.room_id,
    data.title,
    data.summary_md || "",
    data.status || "draft",
  );
  return getPlan(Number(result.lastInsertRowid))!;
}

export function updatePlan(
  planId: number,
  fields: Partial<Pick<
    PlanRow,
    | "title"
    | "summary_md"
    | "status"
    | "execution_state"
    | "execution_started_at"
    | "execution_paused_at"
    | "execution_paused_ms"
    | "current_version"
  >>,
): void {
  buildUpdate("plans", "id", planId, fields);
}

export function getPlanStep(stepId: number): PlanStepRow | undefined {
  return getDb().prepare("SELECT * FROM plan_steps WHERE id = ?").get(stepId) as PlanStepRow | undefined;
}

export function getActivePlanStepByConversation(conversationId: number): PlanStepRow | undefined {
  return getDb().prepare(
    `SELECT * FROM plan_steps
     WHERE linked_conversation_id = ?
       AND status IN ('implementing', 'fixing')
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  ).get(conversationId) as PlanStepRow | undefined;
}

export function getPlanSteps(planId: number): PlanStepRow[] {
  return getDb().prepare(
    `SELECT * FROM plan_steps
     WHERE plan_id = ?
     ORDER BY position ASC, id ASC`
  ).all(planId) as PlanStepRow[];
}

export function createPlanStep(data: {
  plan_id: number;
  title: string;
  position?: number;
  objective_md?: string;
  implementation_prompt_md?: string;
  acceptance_criteria_md?: string;
  risk_level?: PlanStepRiskLevel;
  requires_architecture_review?: boolean;
  requires_security_review?: boolean;
  status?: PlanStepStatus;
}): PlanStepRow {
  const db = getDb();
  return db.transaction(() => {
    const position = data.position ?? ((db.prepare(
      "SELECT COALESCE(MAX(position), -1) as max_position FROM plan_steps WHERE plan_id = ?"
    ).get(data.plan_id) as { max_position: number }).max_position + 1);

    const result = db.prepare(
      `INSERT INTO plan_steps
        (plan_id, position, title, objective_md, implementation_prompt_md, acceptance_criteria_md, risk_level,
         requires_architecture_review, requires_security_review, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.plan_id,
      position,
      data.title,
      data.objective_md || "",
      data.implementation_prompt_md || "",
      data.acceptance_criteria_md || "",
      data.risk_level || "medium",
      data.requires_architecture_review ? 1 : 0,
      data.requires_security_review ? 1 : 0,
      data.status || "pending",
    );
    return db.prepare("SELECT * FROM plan_steps WHERE id = ?").get(result.lastInsertRowid) as PlanStepRow;
  })();
}

export function deletePlanSteps(planId: number): void {
  getDb().prepare("DELETE FROM plan_steps WHERE plan_id = ?").run(planId);
}

export function updatePlanStep(
  stepId: number,
  fields: Partial<Pick<
    PlanStepRow,
    | "title"
    | "objective_md"
    | "implementation_prompt_md"
    | "acceptance_criteria_md"
    | "risk_level"
    | "requires_architecture_review"
    | "requires_security_review"
    | "status"
    | "linked_work_item_id"
    | "linked_conversation_id"
    | "fix_attempts"
    | "base_commit_sha"
    | "commit_sha"
    | "result_summary_md"
  >>,
): void {
  const normalizedFields = fields as Record<string, unknown>;
  for (const key of [
    "requires_architecture_review",
    "requires_security_review",
  ] as const) {
    if (typeof normalizedFields[key] === "boolean") {
      normalizedFields[key] = normalizedFields[key] ? 1 : 0;
    }
  }
  buildUpdate("plan_steps", "id", stepId, normalizedFields);
}

export function createPlanStepEvent(data: {
  plan_step_id: number;
  phase: string;
  status: string;
  agent_key?: string | null;
  summary_md?: string;
  payload_json?: string | null;
}): PlanStepEventRow {
  const result = getDb().prepare(
    `INSERT INTO plan_step_events (plan_step_id, phase, agent_key, status, summary_md, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    data.plan_step_id,
    data.phase,
    data.agent_key ?? null,
    data.status,
    data.summary_md || "",
    data.payload_json ?? null,
  );
  return getDb().prepare("SELECT * FROM plan_step_events WHERE id = ?").get(result.lastInsertRowid) as PlanStepEventRow;
}

export function claimPlanStepEvent(eventId: number): boolean {
  const result = getDb().prepare(
    `UPDATE plan_step_events
     SET status = 'running',
         updated_at = datetime('now')
     WHERE id = ?
       AND status = 'pending'`
  ).run(eventId);
  return result.changes === 1;
}

export function updatePlanStepEvent(
  eventId: number,
  fields: Partial<Pick<PlanStepEventRow, "status" | "summary_md" | "payload_json">>,
): void {
  buildUpdate("plan_step_events", "id", eventId, fields);
}

export function getPlanStepEvents(stepId: number): PlanStepEventRow[] {
  return getDb().prepare(
    `SELECT * FROM plan_step_events
     WHERE plan_step_id = ?
     ORDER BY created_at ASC, id ASC`
  ).all(stepId) as PlanStepEventRow[];
}
