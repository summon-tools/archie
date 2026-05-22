import { getDb } from "../db";
import { checkPortSync } from "../apps";
import type { AppRow, AppResponse, WorkItemCounts } from "../types";
import { getWorkItemCounts } from "./work-items";
import { getConversationStats } from "./conversations";

export function getApp(appId: number): AppRow | undefined {
  return getDb().prepare("SELECT * FROM apps WHERE id = ?").get(appId) as AppRow | undefined;
}

export function getApps(): AppRow[] {
  return getDb().prepare("SELECT * FROM apps ORDER BY created_at DESC").all() as AppRow[];
}

export function getAppByDirectory(directory: string): AppRow | undefined {
  return getDb().prepare("SELECT * FROM apps WHERE directory = ?").get(directory) as AppRow | undefined;
}

export function getAppByGithubRepo(githubRepo: string): AppRow | undefined {
  return getDb().prepare("SELECT * FROM apps WHERE github_repo = ?").get(githubRepo) as AppRow | undefined;
}

export function createApp(data: {
  name: string;
  port: number;
  description?: string;
  directory?: string;
  github_repo?: string;
  owner_user_id?: number;
}): AppRow {
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO apps (name, port, description, directory, github_repo, project_owner_user_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(data.name, data.port, data.description || "", data.directory || "", data.github_repo || "", data.owner_user_id ?? null);
  return db.prepare("SELECT * FROM apps WHERE id = ?").get(result.lastInsertRowid) as AppRow;
}

export function updateApp(
  appId: number,
  fields: { project_owner_user_id?: number | null; description?: string }
): void {
  const db = getDb();
  const setParts: string[] = [];
  const values: unknown[] = [];
  if (fields.project_owner_user_id !== undefined) {
    setParts.push("project_owner_user_id = ?");
    values.push(fields.project_owner_user_id);
  }
  if (fields.description !== undefined) {
    setParts.push("description = ?");
    values.push(fields.description);
  }
  if (setParts.length === 0) return;
  values.push(appId);
  db.prepare(`UPDATE apps SET ${setParts.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteApp(appId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM apps WHERE id = ?").run(appId);
}

export function getAppToolConfig(appId: number, toolKey: string): string | null {
  const row = getDb().prepare(
    "SELECT config_json FROM app_tool_configs WHERE app_id = ? AND tool_key = ?"
  ).get(appId, toolKey) as { config_json: string } | undefined;
  return row?.config_json ?? null;
}

export function setAppToolConfig(appId: number, toolKey: string, configJson: string): void {
  getDb().prepare(
    "INSERT OR REPLACE INTO app_tool_configs (app_id, tool_key, config_json) VALUES (?, ?, ?)"
  ).run(appId, toolKey, configJson);
}

export function deleteAppToolConfig(appId: number, toolKey: string): void {
  getDb().prepare(
    "DELETE FROM app_tool_configs WHERE app_id = ? AND tool_key = ?"
  ).run(appId, toolKey);
}

export function buildAppResponse(app: AppRow): AppResponse {
  const counts = getWorkItemCounts(app.id);
  const isRunning = app.port ? checkPortSync(app.port) : false;

  const stats = getConversationStats(app.id);
  let previewsRunning = 0;
  for (const port of stats.previewPorts) {
    if (checkPortSync(port)) previewsRunning += 1;
  }

  // Get seed_script from app_tool_configs
  const seedConfig = getAppToolConfig(app.id, "seed");
  let seedScript: string | null = null;
  if (seedConfig) {
    try {
      const parsed = JSON.parse(seedConfig);
      seedScript = parsed.script || null;
    } catch {}
  }

  return {
    id: app.id,
    name: app.name,
    port: app.port,
    description: app.description,
    directory: app.directory,
    github_repo: app.github_repo,
    project_owner_user_id: app.project_owner_user_id ?? null,
    is_running: isRunning,
    work_item_counts: counts,
    conversation_stats: {
      total: stats.total,
      open: stats.open,
      previews_running: previewsRunning,
    },
    seed_script: seedScript,
    created_at: app.created_at,
  };
}
