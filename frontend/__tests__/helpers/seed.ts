/**
 * Seeding helpers for integration tests.
 * Insert common rows and return their IDs.
 */
import type Database from "better-sqlite3";

export function seedApp(
  db: Database.Database,
  overrides?: Partial<{ name: string; port: number; description: string; directory: string }>
): { id: number } {
  const { name, port, description, directory } = {
    name: "Test App",
    port: 3001,
    description: "A test application",
    directory: "/tmp/test-app",
    ...overrides,
  };
  const result = db
    .prepare("INSERT INTO apps (name, port, description, directory) VALUES (?, ?, ?, ?)")
    .run(name, port, description, directory);
  return { id: Number(result.lastInsertRowid) };
}

export function seedUser(
  db: Database.Database,
  overrides?: Partial<{ username: string; password_hash: string; name: string; role: string; email: string; color: string }>
): { id: number; username: string } {
  const data = {
    username: "testuser",
    password_hash: "hashed_pw",
    name: "Test User",
    role: "admin",
    email: "test@example.com",
    color: null as string | null,
    ...overrides,
  };
  const result = db
    .prepare("INSERT INTO users (username, password_hash, name, role, email, color) VALUES (?, ?, ?, ?, ?, ?)")
    .run(data.username, data.password_hash, data.name, data.role, data.email, data.color);
  return { id: Number(result.lastInsertRowid), username: data.username };
}

export function seedConversation(
  db: Database.Database,
  appId: number,
  overrides?: Partial<{ kind: string; title: string }>
): { id: number } {
  const data = { kind: "conversation", title: "Test Conversation", ...overrides };
  const result = db
    .prepare("INSERT INTO conversations (app_id, kind, title) VALUES (?, ?, ?)")
    .run(appId, data.kind, data.title);
  return { id: Number(result.lastInsertRowid) };
}

export function seedWorkItem(
  db: Database.Database,
  appId: number,
  conversationId: number,
  overrides?: Partial<{ title: string; summary: string; kind: string; status: string; position: number }>
): { id: number } {
  const data = {
    title: "Test Work Item",
    summary: "A test work item",
    kind: "task",
    status: "in_progress",
    position: 0,
    ...overrides,
  };
  const result = db
    .prepare(
      "INSERT INTO work_items (app_id, primary_conversation_id, title, summary, kind, status, position) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(appId, conversationId, data.title, data.summary, data.kind, data.status, data.position);
  return { id: Number(result.lastInsertRowid) };
}

export function seedMessage(
  db: Database.Database,
  conversationId: number,
  overrides?: Partial<{ role: string; body_md: string; seq: number }>
): { id: number } {
  const data = { role: "user", body_md: "Hello", seq: 1, ...overrides };
  const result = db
    .prepare("INSERT INTO messages (conversation_id, role, body_md, seq) VALUES (?, ?, ?, ?)")
    .run(conversationId, data.role, data.body_md, data.seq);
  return { id: Number(result.lastInsertRowid) };
}

export function seedRun(
  db: Database.Database,
  appId: number,
  overrides?: Partial<{
    conversation_id: number | null;
    work_item_id: number | null;
    workflow_key: string | null;
    status: string;
    provider_id: string;
    model_id: string | null;
  }>
): { id: number } {
  const data = {
    conversation_id: null,
    work_item_id: null,
    workflow_key: null,
    status: "running",
    provider_id: "claude",
    model_id: null,
    ...overrides,
  };
  const result = db
    .prepare(
      "INSERT INTO runs (app_id, conversation_id, work_item_id, workflow_key, status, provider_id, model_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(appId, data.conversation_id, data.work_item_id, data.workflow_key, data.status, data.provider_id, data.model_id);
  return { id: Number(result.lastInsertRowid) };
}
