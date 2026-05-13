import { DEFAULT_HOME_AGENTS, getHomeAgent, isHomeAgentKey, type HomeAgentDefinition, type HomeAgentKey } from "@/lib/home/agents";
import { getAllModels } from "@/lib/server/agent";
import * as dal from "./dal";

type AgentProviderId = HomeAgentDefinition["defaultProvider"];

function isAgentProviderId(value: string): value is AgentProviderId {
  return value === "claude" || value === "codex";
}

export function getProviderForModel(modelId: string): AgentProviderId | null {
  const model = getAllModels().find((candidate) => candidate.id === modelId);
  if (!model || !isAgentProviderId(model.provider)) return null;
  return model.provider;
}

export function resolveHomeAgent(key: HomeAgentKey): HomeAgentDefinition {
  const base = getHomeAgent(key);
  const config = dal.getHomeAgentConfig(key);
  if (!config) return base;

  const provider = isAgentProviderId(config.provider_id) ? config.provider_id : base.defaultProvider;
  return {
    ...base,
    role: config.role.trim() || base.role,
    prompt: config.prompt.trim() || base.prompt,
    defaultProvider: provider,
    defaultModel: config.model_id.trim() || base.defaultModel,
  };
}

export function resolveHomeAgents(): Array<HomeAgentDefinition & { isCustomized: boolean }> {
  const configs = new Map(dal.getHomeAgentConfigs().map((config) => [config.agent_key, config]));
  return DEFAULT_HOME_AGENTS.map((base) => {
    const config = configs.get(base.key);
    const agent = resolveHomeAgent(base.key);
    return {
      ...agent,
      isCustomized: !!config,
    };
  });
}

export function isKnownHomeAgentKey(value: string): value is HomeAgentKey {
  return isHomeAgentKey(value);
}
