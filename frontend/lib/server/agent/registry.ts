/**
 * Provider registry — lazy-instantiates providers and aggregates models.
 */

import type { AgentProvider, ModelEntry } from "./types";
import { ClaudeProvider } from "./providers/claude";
import { CodexCliProvider } from "./providers/codex";

const _providers = new Map<string, AgentProvider>();

function ensureProviders() {
  if (_providers.size === 0) {
    const claude = new ClaudeProvider();
    const codex = new CodexCliProvider();
    _providers.set(claude.id, claude);
    _providers.set(codex.id, codex);
  }
}

export function getProvider(providerId: string): AgentProvider {
  ensureProviders();
  // Normalize: empty/falsy provider defaults to "claude"
  const id = providerId || "claude";
  const provider = _providers.get(id);
  if (!provider) {
    throw new Error(`Unknown provider: "${id}". Available: ${[..._providers.keys()].join(", ")}`);
  }
  return provider;
}

export function getAllProviders(): AgentProvider[] {
  ensureProviders();
  return Array.from(_providers.values());
}

export function getAllModels(): ModelEntry[] {
  return getAllProviders().flatMap((p) => p.listModels());
}

export async function getAvailableProviders(): Promise<AgentProvider[]> {
  const all = getAllProviders();
  const results = await Promise.all(all.map(async (p) => ({ p, ok: await p.isAvailable() })));
  return results.filter((r) => r.ok).map((r) => r.p);
}
