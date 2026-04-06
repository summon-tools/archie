"use client";

import { useState, useEffect } from "react";
import { SpinnerGap, Play, Stop, ArrowsClockwise, CaretDown, Robot } from "@phosphor-icons/react";
import GitHubSection from "./GitHubSection";
import EnvVarsSection from "./EnvVarsSection";

import { getAutomationConfigs, updateAutomationConfig, runAutomationNow, updateProjectOwner, type AutomationConfig } from "@/lib/api";

interface ProjectPanelProps {
  appId: number;
  app: {
    id: number;
    name: string;
    is_running: boolean;
    port: number;
  };
  githubRepo: string;
  onAppAction: (action: "start" | "stop" | "restart") => void;
  actionLoading: string | null;
}

export default function AppSettingsPanel({
  appId,
  app,
  githubRepo,
  onAppAction,
  actionLoading,
}: ProjectPanelProps) {
  const [showGit, setShowGit] = useState(false);
  const [showEnv, setShowEnv] = useState(false);

  // Automation configs
  const [automations, setAutomations] = useState<AutomationConfig[]>([]);
  const [automationsLoading, setAutomationsLoading] = useState(true);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [projectOwner, setProjectOwner] = useState<number | null>(null);
  const [teamUsers, setTeamUsers] = useState<{ id: number; name: string }[]>([]);
  const [cronDrafts, setCronDrafts] = useState<Record<string, string>>({});
  const [cronErrors, setCronErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    getAutomationConfigs(appId)
      .then((data) => {
        setAutomations(data.automations);
        setProjectOwner((data as any).project_owner_user_id ?? null);
      })
      .catch(() => {})
      .finally(() => setAutomationsLoading(false));

    fetch("/api/users", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setTeamUsers((d.users || []).map((u: any) => ({ id: u.id, name: u.name }))))
      .catch(() => {});
  }, [appId]);

  const handleToggleAutomation = async (key: string, enabled: boolean) => {
    try {
      await updateAutomationConfig(appId, key, { enabled });
      setAutomations((prev) => prev.map((a) => a.key === key ? { ...a, enabled } : a));
    } catch {}
  };

  const handleSaveCron = async (key: string) => {
    const draft = cronDrafts[key];
    if (draft === undefined) return;
    const current = automations.find((a) => a.key === key)?.cronExpression;
    if (draft === current) return;
    try {
      await updateAutomationConfig(appId, key, { cron_expression: draft });
      setAutomations((prev) => prev.map((a) => a.key === key ? { ...a, cronExpression: draft } : a));
      setCronErrors((prev) => ({ ...prev, [key]: "" }));
    } catch (err: any) {
      setCronErrors((prev) => ({ ...prev, [key]: err?.message || "Invalid schedule" }));
    }
  };

  const handleRunNow = async (key: string) => {
    setRunningKey(key);
    try {
      await runAutomationNow(appId, key);
    } catch {}
    setTimeout(async () => {
      try {
        const data = await getAutomationConfigs(appId);
        setAutomations(data.automations);
      } catch {}
      setRunningKey(null);
    }, 2000);
  };

  return (
    <div className="p-5 space-y-5">
      <h2 className="text-lg font-semibold text-th-primary">Project Settings</h2>

      {/* App Status & Controls */}
      <div>
        <h4 className="text-xs font-semibold text-th-muted uppercase tracking-wider mb-3">
          Project
        </h4>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 flex-shrink-0 ${
                app.is_running ? "rounded-full bg-green-500" : "rounded-sm bg-th-strong"
              }`}
            />
            <span className="text-sm font-medium text-th-primary truncate">
              {app.name}
            </span>
            {app.is_running ? (
              <a
                href={`/api/p/${app.port}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-400 hover:text-brand-300 font-mono ml-auto hover:underline"
              >
                :{app.port}
              </a>
            ) : (
              <span className="text-xs text-th-muted font-mono ml-auto">
                :{app.port}
              </span>
            )}
          </div>

          <p className="text-xs text-th-dimmed">
            {app.is_running ? (
              <span className="text-st-green font-medium">Running</span>
            ) : (
              <span className="text-th-muted">Stopped</span>
            )}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {!app.is_running ? (
              <button
                onClick={() => onAppAction("start")}
                disabled={actionLoading !== null}
                className="px-3 py-1.5 text-xs bg-st-green text-st-green rounded-lg hover:bg-st-green-hover font-medium disabled:opacity-50 flex items-center gap-1 transition-colors"
              >
                {actionLoading === "start" ? (
                  <>
                    <SpinnerGap size={12} className="animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play size={12} weight="fill" />
                    Start
                  </>
                )}
              </button>
            ) : (
              <>
                <button
                  onClick={() => onAppAction("stop")}
                  disabled={actionLoading !== null}
                  className="px-3 py-1.5 text-xs bg-st-red text-st-red-strong rounded-lg hover:bg-st-red-hover font-medium disabled:opacity-50 flex items-center gap-1 transition-colors"
                >
                  {actionLoading === "stop" ? (
                    <>
                      <SpinnerGap size={12} className="animate-spin" />
                      Stopping...
                    </>
                  ) : (
                    <>
                      <Stop size={12} weight="fill" />
                      Stop
                    </>
                  )}
                </button>
                <button
                  onClick={() => onAppAction("restart")}
                  disabled={actionLoading !== null}
                  className="px-3 py-1.5 text-xs bg-st-blue text-st-blue rounded-lg hover:bg-st-blue-hover font-medium disabled:opacity-50 flex items-center gap-1 transition-colors"
                >
                  {actionLoading === "restart" ? (
                    <>
                      <SpinnerGap size={12} className="animate-spin" />
                      Restarting...
                    </>
                  ) : (
                    <>
                      <ArrowsClockwise size={12} weight="bold" />
                      Restart
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Git section (collapsible) */}
      <div className="border-t border-th pt-4">
        <button
          onClick={() => setShowGit(!showGit)}
          className="w-full flex items-center justify-between text-xs font-semibold text-th-muted uppercase tracking-wider mb-2"
        >
          <span>Git & GitHub</span>
          <CaretDown size={14} weight="bold" className={`transition-transform ${showGit ? "rotate-180" : ""}`} />
        </button>
        {showGit && (
          <div>
            <GitHubSection appId={appId} githubRepo={githubRepo} />
          </div>
        )}
      </div>

      {/* Env vars section (collapsible) */}
      <div className="border-t border-th pt-4">
        <button
          onClick={() => setShowEnv(!showEnv)}
          className="w-full flex items-center justify-between text-xs font-semibold text-th-muted uppercase tracking-wider mb-2"
        >
          <span>Environment</span>
          <CaretDown size={14} weight="bold" className={`transition-transform ${showEnv ? "rotate-180" : ""}`} />
        </button>
        {showEnv && (
          <div>
            <EnvVarsSection appId={appId} />
          </div>
        )}
      </div>

      {/* Automations */}
      <div className="border-t border-th pt-4">
        <h4 className="text-xs font-semibold text-th-muted uppercase tracking-wider mb-3">
          Automations
        </h4>

        {/* Project Owner */}
        <div className="mb-4 p-3 border border-th rounded-lg">
          <label className="block text-xs font-medium text-th-secondary mb-1.5">
            Project Owner
          </label>
          <p className="text-meta text-th-dimmed mb-2">
            Receives app-level notifications like weekly spec drift reviews.
          </p>
          <select
            value={projectOwner ?? ""}
            onChange={async (e) => {
              const val = e.target.value ? Number(e.target.value) : null;
              setProjectOwner(val);
              try { await updateProjectOwner(appId, val); } catch {}
            }}
            className="w-full text-xs bg-transparent text-th-secondary border border-th rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-400"
          >
            <option value="">Not set</option>
            {teamUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        {automationsLoading ? (
          <div className="flex items-center gap-2 text-xs text-th-muted">
            <SpinnerGap size={12} className="animate-spin" />
            Loading...
          </div>
        ) : automations.length === 0 ? (
          <p className="text-xs text-th-dimmed">No automations registered.</p>
        ) : (
          <div className="space-y-3">
            {automations.map((auto) => (
              <div key={auto.key} className="border border-th rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Robot size={14} weight="bold" className="text-th-muted" />
                    <span className="text-sm font-medium text-th-primary">{auto.name}</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={auto.enabled}
                      onChange={(e) => handleToggleAutomation(auto.key, e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-th-strong rounded-full peer peer-checked:bg-brand-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                </div>
                <p className="text-xs text-th-muted">{auto.description}</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <label className="text-meta text-th-dimmed w-14 flex-shrink-0">Schedule</label>
                    <input
                      type="text"
                      value={cronDrafts[auto.key] ?? auto.cronExpression}
                      onChange={(e) => setCronDrafts((prev) => ({ ...prev, [auto.key]: e.target.value }))}
                      onBlur={() => handleSaveCron(auto.key)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveCron(auto.key)}
                      className="font-mono text-meta bg-transparent border border-th rounded px-1.5 py-0.5 text-th-secondary focus:outline-none focus:border-brand-400 w-32"
                      placeholder="0 22 * * *"
                      title="5-field cron: min hour dom month dow (UTC)"
                    />
                    {auto.lastRunAt && (
                      <span className="text-meta text-th-dimmed">Last ran: {new Date(auto.lastRunAt).toLocaleString()}</span>
                    )}
                  </div>
                  {cronErrors[auto.key] && (
                    <p className="text-meta text-st-red pl-16">{cronErrors[auto.key]}</p>
                  )}
                </div>
                <button
                  onClick={() => handleRunNow(auto.key)}
                  disabled={runningKey !== null}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-th text-th-secondary hover:text-th-primary hover:border-th-strong transition-colors disabled:opacity-50"
                >
                  {runningKey === auto.key ? (
                    <>
                      <SpinnerGap size={11} className="animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play size={11} weight="fill" />
                      Run Now
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
