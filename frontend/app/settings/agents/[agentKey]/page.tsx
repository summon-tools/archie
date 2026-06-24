"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import ModelPicker, { getModelProviderLabel } from "@/components/ModelPicker";
import { useToast } from "@/components/Toast";
import { getHomeAgents, getMe, updateHomeAgent } from "@/lib/api";
import type { AgentModelOption, HomeAgentConfig } from "@/lib/types";
import { ArrowLeft, Gear, GitBranch, Heartbeat, Robot, Users } from "@phosphor-icons/react";

type Section = "git" | "team" | "models" | "agents" | "system";

function settingsSectionHref(section: Section) {
  return section === "git" ? "/settings" : `/settings?section=${section}`;
}

function getProviderLabel(provider: string) {
  return getModelProviderLabel(provider);
}

export default function AgentSettingsEditPage() {
  const router = useRouter();
  const params = useParams<{ agentKey: string }>();
  const toast = useToast();
  const agentKey = Array.isArray(params.agentKey) ? params.agentKey[0] : params.agentKey;
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<HomeAgentConfig | null>(null);
  const [availableModels, setAvailableModels] = useState<AgentModelOption[]>([]);
  const [draft, setDraft] = useState<{ role: string; prompt: string; model_id: string } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const navItems: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: "git", label: "Git & GitHub", icon: <GitBranch size={20} /> },
    { key: "team", label: "Team", icon: <Users size={20} /> },
    { key: "models", label: "Models", icon: <Gear size={20} /> },
    { key: "agents", label: "Agents", icon: <Robot size={20} /> },
    { key: "system", label: "System", icon: <Heartbeat size={20} /> },
  ];

  const loadAgent = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const me = await getMe();
      if (me.role !== "admin") {
        router.replace("/");
        return;
      }
      setAuthorized(true);
      const data = await getHomeAgents();
      const nextAgent = data.agents.find((candidate) => candidate.key === agentKey) || null;
      setAvailableModels(data.availableModels);
      setAgent(nextAgent);
      setDraft(nextAgent ? {
        role: nextAgent.role,
        prompt: nextAgent.prompt,
        model_id: nextAgent.defaultModel,
      } : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load agent");
    } finally {
      setLoading(false);
    }
  }, [agentKey, router]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  const selectedModel = useMemo(() => (
    draft ? availableModels.find((model) => model.id === draft.model_id) || null : null
  ), [availableModels, draft]);

  const isDirty = !!agent && !!draft && (
    draft.role !== agent.role ||
    draft.prompt !== agent.prompt ||
    draft.model_id !== agent.defaultModel
  );

  const handleSave = async () => {
    if (!agent || !draft || saving) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const data = await updateHomeAgent({
        agent_key: agent.key,
        role: draft.role,
        prompt: draft.prompt,
        model_id: draft.model_id,
      });
      const updatedAgent = data.agents.find((candidate) => candidate.key === agent.key);
      if (!updatedAgent) throw new Error("Agent was not returned after save");
      setAgent(updatedAgent);
      setAvailableModels(data.availableModels);
      setDraft({
        role: updatedAgent.role,
        prompt: updatedAgent.prompt,
        model_id: updatedAgent.defaultModel,
      });
      setSaved(true);
      toast.success(`${updatedAgent.name} saved`);
      setTimeout(() => setSaved(false), 1800);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save agent";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || (!authorized && !error)) {
    return (
      <>
        <Header />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-12 bg-th-muted rounded-xl" />
            <div className="h-96 bg-th-muted rounded-xl" />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex gap-8">
          <nav className="w-52 shrink-0 sticky top-8 self-start">
            <ul className="space-y-1">
              {navItems.map((item) => (
                <li key={item.key}>
                  <button
                    onClick={() => router.push(settingsSectionHref(item.key))}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      item.key === "agents"
                        ? "bg-btn-secondary text-btn-secondary"
                        : "text-th-muted hover:text-th-primary hover:bg-th-subtle"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-6 px-3 text-xs text-th-dimmed">
              Archie v{process.env.APP_VERSION || "?"}
            </div>
          </nav>

          <div className="flex-1 min-w-0">
            {!agent || !draft ? (
              <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
                <button
                  onClick={() => router.push("/settings?section=agents")}
                  className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-th-muted hover:text-th-primary transition-colors"
                >
                  <ArrowLeft size={13} weight="bold" />
                  Agents
                </button>
                <h2 className="text-lg font-bold text-th-primary mb-1">
                  {error ? "Agent settings unavailable" : "Agent not found"}
                </h2>
                <p className="text-sm text-th-dimmed">
                  {error || "This agent is not available in the default team."}
                </p>
              </div>
            ) : (
              <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <button
                      onClick={() => router.push("/settings?section=agents")}
                      className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-th-muted hover:text-th-primary transition-colors"
                    >
                      <ArrowLeft size={13} weight="bold" />
                      Agents
                    </button>
                    <div className="flex items-center gap-2">
                      <Robot size={18} weight="bold" className="text-th-muted" />
                      <h2 className="text-lg font-bold text-th-primary">{agent.name}</h2>
                      {agent.isCustomized && (
                        <span className="rounded-full bg-brand-500/10 px-2 py-1 text-meta font-medium text-brand-400">
                          customized
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-th-dimmed">
                      Name is fixed. Description, markdown prompt, and model are editable.
                    </p>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={!isDirty || saving}
                    className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 text-sm font-medium"
                  >
                    {saving ? "Saving..." : saved ? "Saved" : "Save agent"}
                  </button>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-th-secondary">Description</span>
                    <input
                      value={draft.role}
                      onChange={(event) => setDraft({ ...draft, role: event.target.value })}
                      className="w-full rounded-lg border border-th bg-th-subtle px-3 py-2 text-sm text-th-primary focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-th-secondary">Model</span>
                    <ModelPicker
                      model={draft.model_id}
                      provider={selectedModel?.provider}
                      availableModels={availableModels}
                      onChange={(_provider, modelId) => setDraft({ ...draft, model_id: modelId })}
                      placement="below-left"
                      variant="field"
                    />
                    {selectedModel && (
                      <span className="text-meta text-th-dimmed">
                        Provider: {getProviderLabel(selectedModel.provider)}
                      </span>
                    )}
                  </label>
                </div>

                <label className="mt-5 block space-y-1">
                  <span className="text-xs font-medium text-th-secondary">Prompt Markdown</span>
                  <textarea
                    value={draft.prompt}
                    onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                    rows={24}
                    className="w-full resize-y rounded-lg border border-th bg-th-subtle px-3 py-2 font-mono text-xs leading-relaxed text-th-primary focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent"
                  />
                </label>

                {error && (
                  <p className="mt-3 text-sm text-st-red">{error}</p>
                )}

                <div className="mt-5 flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={!isDirty || saving}
                    className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 text-sm font-medium"
                  >
                    {saving ? "Saving..." : saved ? "Saved" : "Save agent"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
