import { getDb } from "../db";
import type { HomeAgentConfigRow } from "../types";

export function getHomeAgentConfigs(): HomeAgentConfigRow[] {
  return getDb().prepare(
    "SELECT * FROM home_agent_configs ORDER BY agent_key ASC"
  ).all() as HomeAgentConfigRow[];
}

export function getHomeAgentConfig(agentKey: string): HomeAgentConfigRow | undefined {
  return getDb().prepare(
    "SELECT * FROM home_agent_configs WHERE agent_key = ?"
  ).get(agentKey) as HomeAgentConfigRow | undefined;
}

export function upsertHomeAgentConfig(
  agentKey: string,
  fields: {
    role: string;
    prompt: string;
    provider_id: string;
    model_id: string;
  },
): HomeAgentConfigRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO home_agent_configs (agent_key, role, prompt, provider_id, model_id, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(agent_key) DO UPDATE SET
       role = excluded.role,
       prompt = excluded.prompt,
       provider_id = excluded.provider_id,
       model_id = excluded.model_id,
       updated_at = datetime('now')`
  ).run(agentKey, fields.role, fields.prompt, fields.provider_id, fields.model_id);

  return getHomeAgentConfig(agentKey)!;
}
