"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Key, CaretDown, Eye, EyeSlash, X, SpinnerGap } from "@phosphor-icons/react";
import { updateEnvVars, EnvVar } from "@/lib/api";
import { fetcher } from "@/lib/swr";

interface EnvVarsSectionProps {
  appId: number;
}

export default function EnvVarsSection({ appId }: EnvVarsSectionProps) {
  const { data, isLoading: loading } = useSWR<{ env_vars: EnvVar[] }>(
    `/api/apps/${appId}/env`,
    fetcher,
  );
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  // New var form
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  // Sync fetched data into local state (for editing)
  useEffect(() => {
    if (data?.env_vars && !dirty) {
      setEnvVars(data.env_vars);
    }
  }, [data, dirty]);

  const handleAdd = () => {
    const key = newKey.trim();
    const value = newValue;
    if (!key) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      setMessage({ type: "error", text: "Invalid key name. Use letters, numbers, and underscores only." });
      return;
    }
    // Check for duplicates
    if (envVars.some((v) => v.key === key)) {
      setMessage({ type: "error", text: `Variable ${key} already exists. Edit it inline instead.` });
      return;
    }
    setEnvVars([...envVars, { key, value }]);
    setNewKey("");
    setNewValue("");
    setDirty(true);
    setMessage(null);
  };

  const handleRemove = (key: string) => {
    setEnvVars(envVars.filter((v) => v.key !== key));
    setDirty(true);
    setMessage(null);
  };

  const handleValueChange = (key: string, newVal: string) => {
    setEnvVars(envVars.map((v) => (v.key === key ? { ...v, value: newVal } : v)));
    setDirty(true);
    setMessage(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateEnvVars(appId, envVars);
      setDirty(false);
      setMessage({ type: "success", text: "Environment variables saved to .env" });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const toggleVisibility = (key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="bg-th-surface rounded-xl border border-th p-6">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
        aria-expanded={expanded}
      >
        <h3 className="text-lg font-semibold text-th-primary flex items-center gap-2">
          <Key size={20} className="text-amber-600" />
          Environment Variables
          {!loading && envVars.length > 0 && (
            <span className="text-xs bg-th-muted text-th-muted px-2 py-0.5 rounded-full font-normal">
              {envVars.length}
            </span>
          )}
        </h3>
        <CaretDown size={20} className={`text-th-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-4 space-y-4">
          {loading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-8 bg-th-muted rounded w-full" />
              <div className="h-8 bg-th-muted rounded w-full" />
            </div>
          ) : (
            <>
              {/* Existing variables */}
              {envVars.length > 0 ? (
                <div className="space-y-2">
                  {envVars.map((v) => (
                    <div key={v.key} className="flex items-center gap-2 group">
                      <span className="text-sm font-mono text-th-secondary w-48 flex-shrink-0 truncate font-medium">
                        {v.key}
                      </span>
                      <span className="text-th-dimmed">=</span>
                      <div className="flex-1 relative">
                        <input
                          type={visibleKeys.has(v.key) ? "text" : "password"}
                          value={v.value}
                          onChange={(e) => handleValueChange(v.key, e.target.value)}
                          className="w-full px-2 py-1.5 text-sm font-mono bg-th-subtle border border-th rounded focus:ring-2 focus:ring-th focus:border-transparent text-th-primary pr-8"
                          aria-label={`Value for ${v.key}`}
                        />
                        <button
                          type="button"
                          onClick={() => toggleVisibility(v.key)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-th-dimmed hover:text-th-primary"
                          title={visibleKeys.has(v.key) ? "Hide" : "Show"}
                          aria-label={visibleKeys.has(v.key) ? `Hide ${v.key} value` : `Show ${v.key} value`}
                        >
                          {visibleKeys.has(v.key) ? (
                            <EyeSlash size={16} weight="bold" />
                          ) : (
                            <Eye size={16} weight="bold" />
                          )}
                        </button>
                      </div>
                      <button
                        onClick={() => handleRemove(v.key)}
                        className="text-th-dimmed hover:text-st-red-strong transition opacity-0 group-hover:opacity-100"
                        title="Remove"
                        aria-label={`Remove ${v.key}`}
                      >
                        <X size={16} weight="bold" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-th-muted italic">No environment variables set</p>
              )}

              {/* Add new variable */}
              <div className="flex items-center gap-2 pt-2 border-t border-th">
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                  placeholder="KEY_NAME"
                  aria-label="New variable name"
                  className="w-48 flex-shrink-0 px-2 py-1.5 text-sm font-mono bg-th-subtle border border-th rounded focus:ring-2 focus:ring-th focus:border-transparent text-th-primary placeholder-th"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newKey.trim() && newValue) {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                />
                <span className="text-th-dimmed">=</span>
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="value"
                  aria-label="New variable value"
                  className="flex-1 px-2 py-1.5 text-sm font-mono bg-th-subtle border border-th rounded focus:ring-2 focus:ring-th focus:border-transparent text-th-primary placeholder-th"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newKey.trim() && newValue) {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                />
                <button
                  onClick={handleAdd}
                  disabled={!newKey.trim()}
                  className="px-3 py-1.5 text-sm bg-btn-secondary text-btn-secondary rounded hover:bg-btn-secondary-hover disabled:opacity-50 font-medium"
                >
                  Add
                </button>
              </div>

              {/* Message */}
              {message && (
                <div
                  className={`text-sm px-3 py-2 rounded-lg ${
                    message.type === "success"
                      ? "bg-st-green border border-st-green text-st-green"
                      : "bg-st-red border border-st-red text-st-red"
                  }`}
                >
                  {message.text}
                </div>
              )}

              {/* Save button */}
              {dirty && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 text-sm bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover disabled:opacity-50 font-medium flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <SpinnerGap size={14} className="animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </button>
                  <span className="text-xs text-amber-400">Unsaved changes</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
