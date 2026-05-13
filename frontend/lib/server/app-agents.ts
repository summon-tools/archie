import type { HomeAgentKey } from "@/lib/home/agents";
import { resolveHomeAgent } from "./home-agent-configs";

// Compatibility shim for stale dev-server module graphs from the earlier app-scoped implementation.
export function resolveHomeAgentForApp(_appId: number, key: HomeAgentKey) {
  return resolveHomeAgent(key);
}
