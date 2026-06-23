"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Copy, Key, SpinnerGap, Trash, Warning } from "@phosphor-icons/react";
import type { App, McpToken } from "@/lib/types";
import {
  createMcpToken,
  deleteMcpToken,
  fetchMcpTokens,
  getApps,
  MCP_SCOPES,
  revokeMcpToken,
  type McpTokenPayload,
} from "@/lib/api";

interface McpTokensSettingsSectionProps {
  onNotify?: (type: "success" | "error", message: string) => void;
}

const DEFAULT_SCOPES = [
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
];

const SCOPE_LABELS: Record<string, string> = {
  "apps:read": "Read apps",
  "skills:read": "Read skills",
  "project:read": "Ask codebase",
  "tasks:read": "Read tasks",
  "tasks:write": "Start tasks",
  "tasks:stop": "Stop tasks",
  "servers:read": "Read servers",
  "servers:start": "Start servers",
  "servers:stop": "Stop servers",
  "activity:read": "Read activity",
};

function formatDate(value: string | null): string {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function creatorLabel(token: McpToken): string {
  if (token.created_by_user_name) return token.created_by_user_name;
  if (token.created_by_user_id) return `User #${token.created_by_user_id}`;
  return "Unknown";
}

export default function McpTokensSettingsSection({ onNotify }: McpTokensSettingsSectionProps) {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [appScopeMode, setAppScopeMode] = useState<"all" | "selected">("all");
  const [allowedAppIds, setAllowedAppIds] = useState<number[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("/api/mcp");

  const activeTokens = useMemo(() => tokens.filter((token) => !token.revoked_at), [tokens]);
  const revokedTokens = useMemo(() => tokens.filter((token) => token.revoked_at), [tokens]);
  const canCreate = Boolean(
    name.trim() &&
    scopes.length > 0 &&
    (appScopeMode === "all" || allowedAppIds.length > 0) &&
    !saving,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tokenData, appData] = await Promise.all([
        fetchMcpTokens(),
        getApps(),
      ]);
      setTokens(tokenData.tokens);
      setApps(appData);
    } catch (error) {
      onNotify?.("error", error instanceof Error ? error.message : "Failed to load MCP tokens");
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setMcpUrl(`${window.location.origin}/api/mcp`);
  }, []);

  const clientConfig = useMemo(() => JSON.stringify({
    mcpServers: {
      archie: {
        url: mcpUrl,
        headers: {
          Authorization: "Bearer <paste token here>",
        },
      },
    },
  }, null, 2), [mcpUrl]);

  const toggleScope = (scope: string) => {
    setScopes((current) => (
      current.includes(scope)
        ? current.filter((entry) => entry !== scope)
        : [...current, scope]
    ));
  };

  const toggleApp = (appId: number) => {
    setAllowedAppIds((current) => (
      current.includes(appId)
        ? current.filter((entry) => entry !== appId)
        : [...current, appId]
    ));
  };

  const handleCreate = async () => {
    if (!name.trim() || scopes.length === 0) return;
    setSaving(true);
    try {
      const payload: McpTokenPayload = {
        name: name.trim(),
        scopes,
        allowed_app_ids: appScopeMode === "all" ? [] : allowedAppIds,
      };
      const result = await createMcpToken(payload);
      setNewSecret(result.secret);
      setName("");
      setScopes(DEFAULT_SCOPES);
      setAppScopeMode("all");
      setAllowedAppIds([]);
      setIsCreateOpen(false);
      onNotify?.("success", "MCP token created");
      await load();
    } catch (error) {
      onNotify?.("error", error instanceof Error ? error.message : "Failed to create MCP token");
    } finally {
      setSaving(false);
    }
  };

  const handleCopySecret = async () => {
    if (!newSecret) return;
    await navigator.clipboard.writeText(newSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyWithFlag = async (
    value: string,
    setFlag: (value: boolean) => void,
  ) => {
    await navigator.clipboard.writeText(value);
    setFlag(true);
    setTimeout(() => setFlag(false), 2000);
  };

  const handleRevoke = async (tokenId: number) => {
    setRevokingId(tokenId);
    try {
      await revokeMcpToken(tokenId);
      onNotify?.("success", "MCP token revoked");
      await load();
    } catch (error) {
      onNotify?.("error", error instanceof Error ? error.message : "Failed to revoke MCP token");
    } finally {
      setRevokingId(null);
    }
  };

  const handleDelete = async (token: McpToken) => {
    const confirmed = window.confirm(`Completely delete MCP token "${token.name}"? This removes it from the token list. Audit history will remain but will no longer be linked to this token.`);
    if (!confirmed) return;
    setDeletingId(token.id);
    try {
      await deleteMcpToken(token.id);
      onNotify?.("success", "MCP token deleted");
      await load();
    } catch (error) {
      onNotify?.("error", error instanceof Error ? error.message : "Failed to delete MCP token");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-th-primary mb-1">Install in an MCP client</h2>
            <p className="text-sm text-th-dimmed">
              Add Archie as a remote HTTP MCP server, then use a token from this page as the bearer token.
            </p>
          </div>
          <div className="rounded-lg border border-th bg-th-subtle p-2 text-th-muted">
            <Key size={18} weight="bold" />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-th-dimmed">Server URL</div>
              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-th bg-th-code px-3 py-2 text-xs text-th-primary">
                  {mcpUrl}
                </code>
                <button
                  type="button"
                  onClick={() => copyWithFlag(mcpUrl, setCopiedEndpoint)}
                  className="inline-flex items-center gap-1 rounded-lg bg-btn-secondary px-3 py-2 text-xs font-medium text-btn-secondary hover:bg-btn-secondary-hover"
                >
                  {copiedEndpoint ? <CheckCircle size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                  {copiedEndpoint ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium uppercase text-th-dimmed">Example config</div>
              <button
                type="button"
                onClick={() => copyWithFlag(clientConfig, setCopiedConfig)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-th-secondary hover:bg-th-muted hover:text-th-primary"
              >
                {copiedConfig ? <CheckCircle size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                {copiedConfig ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-56 overflow-auto rounded-xl border border-th bg-th-code p-3 text-xs text-th-primary">
              <code>{clientConfig}</code>
            </pre>
          </div>
        </div>

      </div>

      <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-th-primary mb-1">Remote MCP</h2>
            <p className="text-sm text-th-dimmed">
              Token access for Claude, Cursor, ChatGPT, and compatible MCP clients.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsCreateOpen((current) => !current)}
            className="inline-flex items-center gap-2 rounded-lg bg-btn-secondary px-3 py-2 text-xs font-medium text-btn-secondary hover:bg-btn-secondary-hover"
          >
            <Key size={14} weight="bold" />
            {isCreateOpen ? "Hide form" : "Generate token"}
          </button>
        </div>

        {newSecret && (
          <div className="mb-5 rounded-xl border border-st-amber bg-th-subtle p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-st-amber">
              <Warning size={16} weight="bold" />
              Copy this token now
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-th bg-th-code px-3 py-2 text-xs text-th-primary">
                {newSecret}
              </code>
              <button
                type="button"
                onClick={handleCopySecret}
                className="inline-flex items-center gap-1 rounded-lg bg-btn-secondary px-3 py-2 text-xs font-medium text-btn-secondary hover:bg-btn-secondary-hover"
              >
                {copied ? <CheckCircle size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {isCreateOpen && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-th-secondary">Token name</label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Token Name"
                  required
                  className="w-full rounded-lg border border-th bg-th-subtle px-3 py-2 text-sm text-th-primary focus:border-transparent focus:ring-2 focus:ring-th"
                />
                <p className="mt-1 text-xs text-th-dimmed">
                  Use a recognizable name so the team can identify this token later.
                </p>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-th-secondary">Scopes</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {MCP_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-center gap-2 rounded-lg border border-th bg-th-subtle px-3 py-2 text-sm text-th-primary">
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        className="h-4 w-4 rounded border-th"
                      />
                      <span>{SCOPE_LABELS[scope] || scope}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-2 text-sm font-medium text-th-secondary">Apps</div>
                <div className="max-h-56 overflow-auto rounded-xl border border-th">
                  <label className="flex items-center gap-2 border-b border-th bg-th-subtle px-3 py-2 text-sm text-th-primary">
                    <input
                      type="checkbox"
                      checked={appScopeMode === "all"}
                      onChange={() => {
                        setAppScopeMode("all");
                        setAllowedAppIds([]);
                      }}
                      className="h-4 w-4 rounded border-th"
                    />
                    <span>All apps</span>
                  </label>
                  {apps.map((app) => (
                    <label key={app.id} className="flex items-center gap-2 border-b border-th px-3 py-2 text-sm text-th-primary last:border-b-0">
                      <input
                        type="checkbox"
                        checked={appScopeMode === "selected" && allowedAppIds.includes(app.id)}
                        onChange={() => {
                          setAppScopeMode("selected");
                          toggleApp(app.id);
                        }}
                        className="h-4 w-4 rounded border-th"
                      />
                      <span className="min-w-0 truncate">{app.name}</span>
                    </label>
                  ))}
                </div>
                {appScopeMode === "selected" && allowedAppIds.length === 0 && (
                  <p className="mt-2 text-xs text-st-amber">Select at least one app.</p>
                )}
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={!canCreate}
                className="w-full rounded-lg bg-btn-primary px-4 py-2 text-sm font-medium text-btn-primary hover:bg-btn-primary-hover disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create token"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-th-primary">Tokens</h3>
            <p className="text-sm text-th-dimmed">{activeTokens.length} active, {revokedTokens.length} revoked</p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-btn-secondary px-3 py-1.5 text-xs font-medium text-btn-secondary hover:bg-btn-secondary-hover disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-th bg-th-subtle px-3 py-4 text-sm text-th-muted">
            <SpinnerGap size={16} className="animate-spin" />
            Loading tokens...
          </div>
        ) : tokens.length === 0 ? (
          <div className="rounded-lg border border-th bg-th-subtle px-3 py-4 text-sm text-th-muted">
            No MCP tokens yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-th">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-th bg-th-subtle text-left text-xs text-th-dimmed">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Created by</th>
                  <th className="px-3 py-2 font-medium">Prefix</th>
                  <th className="px-3 py-2 font-medium">Apps</th>
                  <th className="px-3 py-2 font-medium">Last used</th>
                  <th className="px-3 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id} className="border-b border-th last:border-0">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-th-primary">{token.name}</div>
                      <div className="text-xs text-th-dimmed">
                        {token.revoked_at ? `Revoked ${formatDate(token.revoked_at)}` : `${token.scopes.length} scopes`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs text-th-secondary">{creatorLabel(token)}</div>
                      <div className="text-xs text-th-dimmed">Created {formatDate(token.created_at)}</div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-th-muted">{token.token_prefix}...</td>
                    <td className="px-3 py-2.5 text-xs text-th-secondary">
                      {token.allowed_app_ids.length === 0 ? "All apps" : `${token.allowed_app_ids.length} apps`}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-th-secondary">{formatDate(token.last_used_at)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        {!token.revoked_at && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(token.id)}
                            disabled={revokingId === token.id || deletingId === token.id}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-st-red hover:bg-th-muted disabled:opacity-50"
                          >
                            <Trash size={12} weight="bold" />
                            {revokingId === token.id ? "Revoking..." : "Revoke"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(token)}
                          disabled={deletingId === token.id || revokingId === token.id}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-st-red hover:bg-th-muted disabled:opacity-50"
                        >
                          <Trash size={12} weight="bold" />
                          {deletingId === token.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
