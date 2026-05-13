"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import type { GitSettings, HomeAgentConfig } from "@/lib/types";
import { getMe, getGitSettings, updateGitSettings, generateSSHKey, getSettings, getUsers, updateUserRole, deleteUser, restoreUser, createInvitation, getInvitations, revokeInvitation, getModelConfig, updateModelConfig, getHomeAgents } from "@/lib/api";
import type { UserInfo, InvitationInfo } from "@/lib/api";
import { GitBranch, CheckCircle, Users, Gear, Heartbeat, Warning, XCircle, Robot, PencilSimple } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

const SETTINGS_SECTIONS = ["git", "team", "models", "agents", "system"] as const;
type Section = (typeof SETTINGS_SECTIONS)[number];

function isSettingsSection(value: string | null): value is Section {
  return !!value && SETTINGS_SECTIONS.includes(value as Section);
}

function settingsSectionHref(section: Section) {
  return section === "git" ? "/settings" : `/settings?section=${section}`;
}

function GhStatusDisplay() {
  const [ghStatus, setGhStatus] = useState<{
    installed: boolean;
    authenticated: boolean;
    user: string | null;
    host: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/gh/status")
      .then((r) => r.json())
      .then(setGhStatus)
      .catch(() => setGhStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-th-muted">Checking...</p>;

  if (!ghStatus?.installed) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-st-red">
          <XCircle size={20} weight="bold" />
          <span className="font-medium">gh CLI not installed</span>
        </div>
        <div className="bg-th-subtle border border-th rounded-lg p-3">
          <p className="text-sm text-th-secondary">
            Install it with: <code className="bg-th-code px-1.5 py-0.5 rounded text-xs">brew install gh</code>
          </p>
        </div>
      </div>
    );
  }

  if (!ghStatus.authenticated) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-st-amber">
          <Warning size={20} weight="bold" />
          <span className="font-medium">gh installed but not authenticated</span>
        </div>
        <div className="bg-th-subtle border border-th rounded-lg p-3">
          <p className="text-sm text-th-secondary">
            Run in your terminal: <code className="bg-th-code px-1.5 py-0.5 rounded text-xs">gh auth login</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-st-green">
        <CheckCircle size={20} weight="bold" />
        <span className="font-medium">Authenticated as @{ghStatus.user}</span>
      </div>
      <div className="text-xs text-th-secondary bg-th-code border border-th rounded-lg p-3 font-mono">
        {ghStatus.host || "github.com"}
      </div>
    </div>
  );
}

function ModelCategoryPicker({
  label, description, modelValue, providerValue, availableModels, onChange,
}: {
  label: string;
  description: string;
  modelValue: string;
  providerValue: string;
  availableModels: { id: string; label: string; provider: string }[];
  onChange: (provider: string, model: string) => void;
}) {
  // Group models by provider
  const providers = Array.from(new Set(availableModels.map(m => m.provider)));
  const modelsForProvider = availableModels.filter(m => m.provider === providerValue);

  return (
    <div>
      <label className="block text-sm font-medium text-th-secondary mb-1">{label}</label>
      <div className="flex gap-2">
        <select
          value={providerValue}
          onChange={(e) => {
            const newProvider = e.target.value;
            const firstModel = availableModels.find(m => m.provider === newProvider);
            onChange(newProvider, firstModel?.id || "");
          }}
          className="px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-primary text-sm focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent appearance-none w-32"
        >
          {providers.map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
        <select
          value={modelValue}
          onChange={(e) => onChange(providerValue, e.target.value)}
          className="flex-1 px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-primary text-sm focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent appearance-none"
        >
          {modelsForProvider.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <p className="text-xs text-th-muted mt-1">{description}</p>
    </div>
  );
}

function AgentSettingsSection({
  agents,
  loading,
  onEditAgent,
}: {
  agents: HomeAgentConfig[];
  loading: boolean;
  onEditAgent: (agentKey: string) => void;
}) {
  return (
    <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-th-muted rounded" />
          <div className="h-56 bg-th-muted rounded" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-th-primary mb-1">Agents</h2>
            <p className="text-sm text-th-dimmed">
              Configure the default descriptions, markdown prompts, and models used by planning rooms and execution gates.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-th">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-th bg-th-subtle text-left text-xs text-th-dimmed">
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.key} className="border-b border-th last:border-0 hover:bg-th-subtle transition-colors">
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => onEditAgent(agent.key)}
                        className="flex min-w-0 items-center gap-2 text-left"
                      >
                        <Robot size={15} weight="bold" className="text-th-muted" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-th-primary">{agent.name}</span>
                            {agent.isCustomized && (
                              <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-meta font-medium text-brand-400">
                                customized
                              </span>
                            )}
                          </div>
                          <div className="max-w-xl truncate text-xs text-th-dimmed">{agent.role}</div>
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs text-th-muted">{agent.defaultModel}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => onEditAgent(agent.key)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-th-secondary hover:bg-th-muted hover:text-th-primary transition-colors"
                      >
                        <PencilSimple size={12} weight="bold" />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const [authorized, setAuthorized] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("git");
  const [settings, setSettings] = useState<GitSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [maskedToken, setMaskedToken] = useState<string | null>(null);
  const [savingToken, setSavingToken] = useState(false);
  const [removingToken, setRemovingToken] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [invitations, setInvitations] = useState<InvitationInfo[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(null);
  const [modelConfig, setModelConfig] = useState({
    chatModel: "", chatProvider: "claude",
    backgroundModel: "", backgroundProvider: "claude",
    quickModel: "", quickProvider: "claude",
    demoModel: "", demoProvider: "claude",
  });
  const [availableModels, setAvailableModels] = useState<{ id: string; label: string; provider: string }[]>([]);
  const [savingModels, setSavingModels] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [agents, setAgents] = useState<HomeAgentConfig[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentErrors, setAgentErrors] = useState<Record<string, string>>({});
  const [systemReadiness, setSystemReadiness] = useState<{
    tools: { name: string; status: string; version?: string; required: boolean; install_hint: string }[];
    providers: { id: string; label: string; available: boolean; error?: string }[];
  } | null>(null);
  const [loadingSystem, setLoadingSystem] = useState(false);
  const [terminalAccessRole, setTerminalAccessRole] = useState<"admin" | "member">("admin");
  const [savingTerminalAccess, setSavingTerminalAccess] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const [data, dashSettings, meRes] = await Promise.all([
        getGitSettings(),
        getSettings(),
        fetch("/api/auth/me").then((r) => r.json()),
      ]);
      setSettings(data);
      setName(data.name);
      setEmail(data.email);
      setMaskedToken(dashSettings.settings.github_token || null);
      if (meRes.email) setCurrentUserEmail(meRes.email);
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const config = await getModelConfig();
      setModelConfig({
        chatModel: config.chatModel, chatProvider: config.chatProvider,
        backgroundModel: config.backgroundModel, backgroundProvider: config.backgroundProvider,
        quickModel: config.quickModel, quickProvider: config.quickProvider,
        demoModel: config.demoModel, demoProvider: config.demoProvider,
      });
      setAvailableModels(config.availableModels || []);
    } catch {
      // ignore — will use defaults
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const data = await getHomeAgents();
      setAgents(data.agents);
      setAgentErrors({});
    } catch (error) {
      setAgentErrors({ _global: error instanceof Error ? error.message : "Failed to load agents" });
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  const loadSystem = useCallback(async () => {
    setLoadingSystem(true);
    try {
      const res = await fetch("/api/setup/readiness");
      if (res.ok) setSystemReadiness(await res.json());
    } catch {}
    // Load terminal access role
    try {
      const res = await fetch("/api/settings/terminal_access_role");
      if (res.ok) {
        const data = await res.json();
        if (data.value) setTerminalAccessRole(data.value);
      }
    } catch {}
    setLoadingSystem(false);
  }, []);

  const loadTeam = useCallback(async () => {
    setLoadingTeam(true);
    try {
      const [u, i] = await Promise.all([getUsers(), getInvitations()]);
      setUsers(u);
      setInvitations(i);
    } catch {
      // ignore — will fail for non-admins
    } finally {
      setLoadingTeam(false);
    }
  }, []);

  useEffect(() => {
    getMe().then((me) => {
      if (me.role !== "admin") {
        router.replace("/");
      } else {
        setAuthorized(true);
        loadSettings();
        loadTeam();
        loadModels();
        loadAgents();
      }
    }).catch(() => {});
  }, [router, loadSettings, loadTeam, loadModels, loadAgents]);

  useEffect(() => {
    const syncSectionFromUrl = () => {
      const section = new URLSearchParams(window.location.search).get("section");
      setActiveSection(isSettingsSection(section) ? section : "git");
    };
    syncSectionFromUrl();
    window.addEventListener("popstate", syncSectionFromUrl);
    return () => window.removeEventListener("popstate", syncSectionFromUrl);
  }, []);

  const showMessage = (type: "success" | "error", text: string) => {
    toast[type](text);
  };

  const handleSaveConfig = async () => {
    if (!name.trim() || !email.trim()) return;
    setSaving(true);
    try {
      await updateGitSettings(name.trim(), email.trim());
      showMessage("success", "Git identity saved");
      loadSettings();
    } catch (err) {
      showMessage(
        "error",
        err instanceof Error ? err.message : "Failed to save"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateKey = async () => {
    setGenerating(true);
    try {
      const result = await generateSSHKey();
      if (result.public_key) {
        setNewlyGeneratedKey(result.public_key);
      }
      showMessage("success", result.message);
      loadSettings();
    } catch (err) {
      showMessage(
        "error",
        err instanceof Error ? err.message : "Failed to generate key"
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyKey = () => {
    if (newlyGeneratedKey) {
      navigator.clipboard.writeText(newlyGeneratedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSaveToken = async () => {
    if (!githubToken.trim()) return;
    setSavingToken(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "github_token", value: githubToken.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to save" }));
        throw new Error(err.detail);
      }
      setGithubToken("");
      showMessage("success", "GitHub token saved");
      loadSettings();
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to save token");
    } finally {
      setSavingToken(false);
    }
  };

  const handleRemoveToken = async () => {
    setRemovingToken(true);
    try {
      const res = await fetch("/api/settings/github_token", { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to remove" }));
        throw new Error(err.detail);
      }
      setMaskedToken(null);
      showMessage("success", "GitHub token removed");
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to remove token");
    } finally {
      setRemovingToken(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteLink(null);
    try {
      const result = await createInvitation(inviteEmail.trim());
      const link = `${window.location.origin}/invite/${result.token}`;
      setInviteLink(link);
      setInviteEmail("");
      showMessage("success", "Invitation created");
      loadTeam();
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to create invitation");
    } finally {
      setInviting(false);
    }
  };

  const handleCopyInviteLink = () => {
    if (inviteLink) {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(inviteLink);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = inviteLink;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    }
  };

  const handleToggleRole = async (userId: number, currentRole: "admin" | "member") => {
    const newRole = currentRole === "admin" ? "member" : "admin";
    try {
      await updateUserRole(userId, newRole);
      showMessage("success", `Role changed to ${newRole}`);
      loadTeam();
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to update role");
    }
  };

  const handleDeleteUser = async (userId: number) => {
    try {
      await deleteUser(userId);
      setConfirmDeleteUserId(null);
      showMessage("success", "User removed");
      loadTeam();
    } catch (err) {
      setConfirmDeleteUserId(null);
      showMessage("error", err instanceof Error ? err.message : "Failed to remove user");
    }
  };

  const handleRestoreUser = async (userId: number) => {
    try {
      await restoreUser(userId);
      showMessage("success", "User restored");
      loadTeam();
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to restore user");
    }
  };

  const handleSaveModels = async () => {
    setSavingModels(true);
    try {
      await updateModelConfig(modelConfig);
      showMessage("success", "Model configuration saved");
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to save model config");
    } finally {
      setSavingModels(false);
    }
  };

  const handleRevokeInvite = async (inviteId: number) => {
    try {
      await revokeInvitation(inviteId);
      showMessage("success", "Invitation revoked");
      loadTeam();
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to revoke invitation");
    }
  };

  const handleToggleTerminalAccess = async () => {
    const newRole = terminalAccessRole === "admin" ? "member" : "admin";
    setSavingTerminalAccess(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "terminal_access_role", value: newRole }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setTerminalAccessRole(newRole);
      showMessage("success", `Terminal access updated: ${newRole === "admin" ? "Admins only" : "All members"}`);
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to update terminal access");
    } finally {
      setSavingTerminalAccess(false);
    }
  };

  const handleSelectSection = (section: Section) => {
    setActiveSection(section);
    router.replace(settingsSectionHref(section), { scroll: false });
  };

  const navItems: { key: Section; label: string; icon: React.ReactNode }[] = [
    {
      key: "git",
      label: "Git & GitHub",
      icon: <GitBranch size={20} />,
    },
    {
      key: "team",
      label: "Team",
      icon: <Users size={20} />,
    },
    {
      key: "models",
      label: "Models",
      icon: <Gear size={20} />,
    },
    {
      key: "agents",
      label: "Agents",
      icon: <Robot size={20} />,
    },
    {
      key: "system",
      label: "System",
      icon: <Heartbeat size={20} />,
    },
  ];

  if (!authorized || loading) {
    return (
      <>
        <Header />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-40 bg-th-muted rounded-xl" />
            <div className="h-40 bg-th-muted rounded-xl" />
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
          {/* Sidebar */}
          <nav className="w-52 shrink-0 sticky top-8 self-start">
            <ul className="space-y-1">
              {navItems.map((item) => (
                <li key={item.key}>
                  <button
                    onClick={() => handleSelectSection(item.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeSection === item.key
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

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-6">
            {activeSection === "git" && (
              <>
                {/* Git Identity */}
                <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
                  <h2 className="text-lg font-bold text-th-primary mb-1">Git Identity</h2>
                  <p className="text-sm text-th-dimmed mb-4">
                    Used for commit author information.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-th-secondary mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your Name"
                        className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-th-secondary mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
                      />
                    </div>
                    <button
                      onClick={handleSaveConfig}
                      disabled={saving || !name.trim() || !email.trim()}
                      className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 text-sm font-medium"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>

                {/* GitHub CLI */}
                <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
                  <h2 className="text-lg font-bold text-th-primary mb-1">GitHub CLI</h2>
                  <p className="text-sm text-th-dimmed mb-4">
                    Archie uses the GitHub CLI (<code className="text-th-secondary">gh</code>) to push code and create pull requests.
                    Authenticate once and it handles everything.
                  </p>

                  <GhStatusDisplay />
                </div>

                {/* Legacy GitHub Token — hidden unless one exists */}
                {maskedToken && (
                  <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl opacity-70">
                    <h2 className="text-sm font-bold text-th-muted mb-1">Legacy GitHub Token</h2>
                    <p className="text-xs text-th-dimmed mb-3">
                      You have a stored GitHub token from before the gh CLI migration. It is no longer needed if <code>gh auth login</code> is configured.
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-th-secondary font-mono bg-th-code border border-th rounded px-2 py-1">{maskedToken}</span>
                      <button
                        onClick={handleRemoveToken}
                        disabled={removingToken}
                        className="px-3 py-1 bg-st-red-hover text-st-red rounded-lg hover:bg-st-red-hover font-medium disabled:opacity-50 text-xs"
                      >
                        {removingToken ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {activeSection === "models" && (
              <>
                <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
                  <h2 className="text-lg font-bold text-th-primary mb-1">Model Configuration</h2>
                  <p className="text-sm text-th-dimmed mb-4">
                    Configure which AI models are used for different types of work.
                  </p>

                  {loadingModels ? (
                    <div className="animate-pulse space-y-4">
                      <div className="h-10 bg-th-muted rounded" />
                      <div className="h-10 bg-th-muted rounded" />
                      <div className="h-10 bg-th-muted rounded" />
                      <div className="h-10 bg-th-muted rounded" />
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <ModelCategoryPicker
                        label="Chat"
                        description="Main conversations with the AI"
                        modelValue={modelConfig.chatModel}
                        providerValue={modelConfig.chatProvider}
                        availableModels={availableModels}
                        onChange={(provider, model) => setModelConfig(prev => ({ ...prev, chatModel: model, chatProvider: provider }))}
                      />
                      <ModelCategoryPicker
                        label="Background"
                        description="Spec generation, codebase indexing, brief generation"
                        modelValue={modelConfig.backgroundModel}
                        providerValue={modelConfig.backgroundProvider}
                        availableModels={availableModels}
                        onChange={(provider, model) => setModelConfig(prev => ({ ...prev, backgroundModel: model, backgroundProvider: provider }))}
                      />
                      <ModelCategoryPicker
                        label="Quick Tasks"
                        description="Commit messages, PR descriptions, intent classification"
                        modelValue={modelConfig.quickModel}
                        providerValue={modelConfig.quickProvider}
                        availableModels={availableModels}
                        onChange={(provider, model) => setModelConfig(prev => ({ ...prev, quickModel: model, quickProvider: provider }))}
                      />
                      <ModelCategoryPicker
                        label="Demo & Walkthrough"
                        description="Navigation scripts, walkthrough planning, seed scripts"
                        modelValue={modelConfig.demoModel}
                        providerValue={modelConfig.demoProvider}
                        availableModels={availableModels}
                        onChange={(provider, model) => setModelConfig(prev => ({ ...prev, demoModel: model, demoProvider: provider }))}
                      />

                      <button
                        onClick={handleSaveModels}
                        disabled={savingModels}
                        className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 text-sm font-medium"
                      >
                        {savingModels ? "Saving..." : "Save"}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeSection === "agents" && (
              <>
                {agentErrors._global && (
                  <div className="rounded-lg border border-st-red bg-th-surface p-3 text-sm text-st-red">
                    {agentErrors._global}
                  </div>
                )}
                <AgentSettingsSection
                  agents={agents}
                  loading={loadingAgents}
                  onEditAgent={(agentKey) => router.push(`/settings/agents/${agentKey}`)}
                />
              </>
            )}

            {activeSection === "system" && (
              <>
                <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-bold text-th-primary mb-1">System Readiness</h2>
                      <p className="text-sm text-th-dimmed">
                        System tools and AI provider availability.
                      </p>
                    </div>
                    <button
                      onClick={loadSystem}
                      disabled={loadingSystem}
                      className="px-3 py-1.5 bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover text-xs font-medium disabled:opacity-50"
                    >
                      {loadingSystem ? "Checking..." : "Refresh"}
                    </button>
                  </div>

                  {!systemReadiness && !loadingSystem && (
                    <button
                      onClick={loadSystem}
                      className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover text-sm font-medium"
                    >
                      Run checks
                    </button>
                  )}

                  {loadingSystem && !systemReadiness && (
                    <div className="animate-pulse space-y-2">
                      <div className="h-8 bg-th-muted rounded" />
                      <div className="h-8 bg-th-muted rounded" />
                    </div>
                  )}

                  {systemReadiness && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-sm font-semibold text-th-secondary mb-3">Tools</h3>
                        <div className="space-y-2">
                          {systemReadiness.tools.map((tool) => (
                            <div key={tool.name} className="flex items-center justify-between px-3 py-2 bg-th-subtle rounded-lg">
                              <div className="flex items-center gap-2">
                                {tool.status === "ok" ? (
                                  <CheckCircle size={18} weight="bold" className="text-st-green" />
                                ) : tool.required ? (
                                  <XCircle size={18} weight="bold" className="text-st-red" />
                                ) : (
                                  <Warning size={18} weight="bold" className="text-st-yellow" />
                                )}
                                <span className="text-sm font-medium text-th-primary">{tool.name}</span>
                                {tool.version && (
                                  <span className="text-xs text-th-dimmed font-mono">{tool.version}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {tool.status === "missing" && (
                                  <span className={`text-xs font-medium ${tool.required ? "text-st-red" : "text-st-yellow"}`}>
                                    {tool.required ? "Required" : "Optional"}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-th-secondary mb-3">AI Providers</h3>
                        <div className="space-y-2">
                          {systemReadiness.providers.map((provider) => (
                            <div key={provider.id} className="flex items-center justify-between px-3 py-2 bg-th-subtle rounded-lg">
                              <div className="flex items-center gap-2">
                                {provider.available ? (
                                  <CheckCircle size={18} weight="bold" className="text-st-green" />
                                ) : (
                                  <XCircle size={18} weight="bold" className="text-st-red" />
                                )}
                                <span className="text-sm font-medium text-th-primary">{provider.label}</span>
                              </div>
                              {!provider.available && (
                                <span className="text-xs text-st-red">{provider.error || "Not available"}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeSection === "team" && (
              <>
                {/* Invite */}
                <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
                  <h2 className="text-lg font-bold text-th-primary mb-1">Invite Team Member</h2>
                  <p className="text-sm text-th-dimmed mb-4">
                    Send an invitation link. The invite expires after 48 hours.
                  </p>

                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="flex-1 px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
                    />
                    <button
                      onClick={handleInvite}
                      disabled={inviting || !inviteEmail.trim()}
                      className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 text-sm font-medium"
                    >
                      {inviting ? "Sending..." : "Invite"}
                    </button>
                  </div>

                  {inviteLink && (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm text-st-green font-medium">Invitation link created:</p>
                      <div className="relative">
                        <pre className="text-xs text-th-secondary bg-th-code border border-th rounded-lg p-3 pr-20 whitespace-pre-wrap break-all font-mono">
                          {inviteLink}
                        </pre>
                        <button
                          onClick={handleCopyInviteLink}
                          className="absolute top-2 right-2 px-3 py-1 text-xs bg-btn-secondary text-btn-secondary rounded-md hover:bg-btn-secondary-hover font-medium"
                        >
                          {inviteCopied ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Users */}
                <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
                  <h2 className="text-lg font-bold text-th-primary mb-4">Users</h2>
                  {loadingTeam ? (
                    <div className="animate-pulse space-y-2">
                      <div className="h-10 bg-th-muted rounded" />
                      <div className="h-10 bg-th-muted rounded" />
                    </div>
                  ) : users.length === 0 ? (
                    <p className="text-sm text-th-muted">No users found.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-th-dimmed border-b border-th">
                          <th className="pb-2 font-medium">Name</th>
                          <th className="pb-2 font-medium">Email</th>
                          <th className="pb-2 font-medium">Admin</th>
                          <th className="pb-2 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => {
                          const isCurrentUser = u.email === currentUserEmail;
                          const isDeleted = !!u.deleted_at;
                          return (
                          <tr key={u.id} className={`border-b border-th last:border-0 ${isDeleted ? "opacity-50" : ""}`}>
                            <td className="py-2.5">
                              <span className={`font-medium ${isDeleted ? "line-through text-th-dimmed" : "text-th-primary"}`}>{u.name}</span>
                              {isCurrentUser && (
                                <span className="ml-1.5 text-xs text-th-dimmed">(you)</span>
                              )}
                              {isDeleted && (
                                <span className="ml-1.5 text-xs text-red-400">(removed)</span>
                              )}
                            </td>
                            <td className={`py-2.5 ${isDeleted ? "text-th-dimmed line-through" : "text-th-muted"}`}>
                              {u.email || <span className="text-th-dimmed">—</span>}
                            </td>
                            <td className="py-2.5">
                              {!isDeleted && (
                                <button
                                  onClick={() => !isCurrentUser && handleToggleRole(u.id, u.role)}
                                  disabled={isCurrentUser}
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                    u.role === "admin" ? "bg-blue-500" : "bg-th-muted"
                                  } ${isCurrentUser ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                                  title={isCurrentUser ? "Cannot change your own role" : `Switch to ${u.role === "admin" ? "member" : "admin"}`}
                                >
                                  <span
                                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                      u.role === "admin" ? "translate-x-[18px]" : "translate-x-[3px]"
                                    }`}
                                  />
                                </button>
                              )}
                            </td>
                            <td className="py-2.5 text-right">
                              {isDeleted ? (
                                <button
                                  onClick={() => handleRestoreUser(u.id)}
                                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                  Restore
                                </button>
                              ) : !isCurrentUser && (
                                confirmDeleteUserId === u.id ? (
                                  <span className="inline-flex items-center gap-2">
                                    <span className="text-xs text-red-400">Remove?</span>
                                    <button
                                      onClick={() => handleDeleteUser(u.id)}
                                      className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      onClick={() => setConfirmDeleteUserId(null)}
                                      className="text-xs text-th-dimmed hover:text-th-primary transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteUserId(u.id)}
                                    className="text-xs text-th-dimmed hover:text-red-400 transition-colors"
                                  >
                                    Remove
                                  </button>
                                )
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Pending Invitations */}
                <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
                  <h2 className="text-lg font-bold text-th-primary mb-4">Pending Invitations</h2>
                  {loadingTeam ? (
                    <div className="animate-pulse space-y-2">
                      <div className="h-10 bg-th-muted rounded" />
                    </div>
                  ) : invitations.filter((i) => !i.accepted_at).length === 0 ? (
                    <p className="text-sm text-th-muted">No pending invitations.</p>
                  ) : (
                    <div className="space-y-2">
                      {invitations
                        .filter((i) => !i.accepted_at)
                        .map((inv) => {
                          const expired = new Date(inv.expires_at) < new Date();
                          return (
                            <div
                              key={inv.id}
                              className="flex items-center justify-between px-3 py-2 bg-th-subtle rounded-lg"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm text-th-primary">{inv.email}</span>
                                {expired ? (
                                  <span className="text-xs text-st-red font-medium">Expired</span>
                                ) : (
                                  <span className="text-xs text-th-dimmed">
                                    Expires {new Date(inv.expires_at).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => handleRevokeInvite(inv.id)}
                                className="text-xs text-th-dimmed hover:text-red-400 transition-colors"
                              >
                                Revoke
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
