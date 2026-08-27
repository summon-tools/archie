"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FloppyDisk, Plus, SpinnerGap, Trash } from "@phosphor-icons/react";
import type { App } from "@/lib/types";
import {
  createProjectReviewDependency,
  deleteProjectReviewDependency,
  getApps,
  getProjectReviewDependencies,
  getProjectReviewPolicy,
  saveProjectReviewPolicy,
  updateProjectReviewDependency,
  type ProjectReviewDependency,
} from "@/lib/api";

type PolicyDraft = {
  priorities: string;
  severity_guidance: string;
  required_checks: string;
  behavior: string;
  tone: string;
};

const DEFAULT_POLICY: PolicyDraft = {
  priorities: "correctness, security, compatibility, tests, data migrations, accessibility",
  severity_guidance: "Publish advisory findings only; do not request changes or block merging.",
  required_checks: "",
  behavior: "Review targeted changes by default.\nAvoid style comments handled by formatters.\nDo not invent product requirements when intent is weak.\nEvery finding needs concrete code or check evidence.",
  tone: "Concise, respectful, evidence-based, and actionable.",
};

function policyDraft(value: string | null | undefined): PolicyDraft {
  if (!value) return DEFAULT_POLICY;
  try {
    const parsed = JSON.parse(value);
    return {
      priorities: Array.isArray(parsed.priorities) ? parsed.priorities.join(", ") : DEFAULT_POLICY.priorities,
      severity_guidance: typeof parsed.severity_guidance === "string" ? parsed.severity_guidance : DEFAULT_POLICY.severity_guidance,
      required_checks: Array.isArray(parsed.required_checks) ? parsed.required_checks.join(", ") : "",
      behavior: Array.isArray(parsed.behavior) ? parsed.behavior.join("\n") : DEFAULT_POLICY.behavior,
      tone: typeof parsed.tone === "string" ? parsed.tone : DEFAULT_POLICY.tone,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

function list(value: string, separator: RegExp): string[] {
  return value.split(separator).map((item) => item.trim()).filter(Boolean);
}

export default function ReviewConfigurationSection({ appId }: { appId: number }) {
  const [policy, setPolicy] = useState<PolicyDraft>(DEFAULT_POLICY);
  const [dependencies, setDependencies] = useState<ProjectReviewDependency[]>([]);
  const [projects, setProjects] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingDependency, setSavingDependency] = useState(false);
  const [mutatingDependencyId, setMutatingDependencyId] = useState<number | null>(null);
  const [showDependencyForm, setShowDependencyForm] = useState(false);
  const [providerAppId, setProviderAppId] = useState("");
  const [sourcePath, setSourcePath] = useState("openapi.yaml");
  const [authoritativeRef, setAuthoritativeRef] = useState("main");
  const [versionExpectation, setVersionExpectation] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const availableProviders = useMemo(() => {
    const linked = new Set(dependencies.map((dependency) => dependency.provider_app_id));
    return projects.filter((project) => project.id !== appId && !linked.has(project.id));
  }, [appId, dependencies, projects]);

  useEffect(() => {
    Promise.all([getProjectReviewPolicy(appId), getProjectReviewDependencies(appId), getApps()])
      .then(([policyResponse, dependencyRows, appRows]) => {
        setPolicy(policyDraft(policyResponse.company_policy?.policy_json));
        setDependencies(dependencyRows);
        setProjects(appRows);
      })
      .catch((error) => setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load review configuration" }))
      .finally(() => setLoading(false));
  }, [appId]);

  const savePolicy = async () => {
    setSavingPolicy(true);
    setMessage(null);
    try {
      await saveProjectReviewPolicy(appId, {
        revision: new Date().toISOString(),
        priorities: list(policy.priorities, /,/),
        severity_guidance: policy.severity_guidance.trim(),
        required_checks: list(policy.required_checks, /,/),
        behavior: list(policy.behavior, /\n/),
        tone: policy.tone.trim(),
      });
      setMessage({ type: "success", text: "Pull-request review policy saved." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save review policy" });
    } finally {
      setSavingPolicy(false);
    }
  };

  const createDependency = async (event: FormEvent) => {
    event.preventDefault();
    setSavingDependency(true);
    setMessage(null);
    try {
      const created = await createProjectReviewDependency(appId, {
        provider_app_id: Number(providerAppId),
        relationship_type: "consumes_api",
        authoritative_ref: authoritativeRef.trim() || "main",
        contract_type: "openapi",
        source_path: sourcePath.trim(),
        version_expectation: versionExpectation.trim() || null,
      });
      setDependencies((current) => [...current, created]);
      setShowDependencyForm(false);
      setProviderAppId("");
      setMessage({ type: "success", text: "Approved OpenAPI dependency saved." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save dependency" });
    } finally {
      setSavingDependency(false);
    }
  };

  const toggleDependency = async (dependency: ProjectReviewDependency) => {
    setMutatingDependencyId(dependency.id);
    setMessage(null);
    try {
      const updated = await updateProjectReviewDependency(appId, dependency.id, {
        state: dependency.state === "active" ? "paused" : "active",
      });
      setDependencies((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to update dependency" });
    } finally {
      setMutatingDependencyId(null);
    }
  };

  const removeDependency = async (dependency: ProjectReviewDependency) => {
    if (!window.confirm(`Remove the approved contract from ${dependency.provider_name || `Project ${dependency.provider_app_id}`}?`)) return;
    setMutatingDependencyId(dependency.id);
    setMessage(null);
    try {
      await deleteProjectReviewDependency(appId, dependency.id);
      setDependencies((current) => current.filter((item) => item.id !== dependency.id));
      setMessage({ type: "success", text: "Approved contract removed." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to remove dependency" });
    } finally {
      setMutatingDependencyId(null);
    }
  };

  if (loading) return <div className="mt-4 flex items-center gap-2 text-xs text-th-muted"><SpinnerGap size={13} className="animate-spin" /> Loading review configuration...</div>;

  return (
    <div className="mt-4 space-y-4 border-t border-th pt-4">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-th-muted">Pull-request review policy</h4>
        <p className="mt-1 text-meta text-th-dimmed">Controls the evidence threshold, priorities, checks, behavior, and tone used by Archie reviews.</p>
        <div className="mt-3 grid gap-2.5">
          <label className="text-xs text-th-secondary">Priorities
            <input value={policy.priorities} onChange={(event) => setPolicy((current) => ({ ...current, priorities: event.target.value }))} className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary" />
          </label>
          <label className="text-xs text-th-secondary">Severity guidance
            <textarea value={policy.severity_guidance} onChange={(event) => setPolicy((current) => ({ ...current, severity_guidance: event.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary" />
          </label>
          <label className="text-xs text-th-secondary">Required checks, comma-separated
            <input value={policy.required_checks} onChange={(event) => setPolicy((current) => ({ ...current, required_checks: event.target.value }))} placeholder="typecheck, test" className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary" />
          </label>
          <label className="text-xs text-th-secondary">Behavior rules, one per line
            <textarea value={policy.behavior} onChange={(event) => setPolicy((current) => ({ ...current, behavior: event.target.value }))} rows={4} className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary" />
          </label>
          <label className="text-xs text-th-secondary">Tone
            <input value={policy.tone} onChange={(event) => setPolicy((current) => ({ ...current, tone: event.target.value }))} className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary" />
          </label>
          <div className="flex justify-end"><button onClick={savePolicy} disabled={savingPolicy} className="flex items-center gap-1.5 rounded-lg bg-btn-secondary px-3 py-1.5 text-xs font-medium text-btn-secondary disabled:opacity-50">{savingPolicy ? <SpinnerGap size={13} className="animate-spin" /> : <FloppyDisk size={13} />}Save policy</button></div>
        </div>
      </div>

      <div className="border-t border-th pt-4">
        <div className="flex items-start justify-between gap-3">
          <div><h4 className="text-xs font-semibold uppercase tracking-wider text-th-muted">Approved API contracts</h4><p className="mt-1 text-meta text-th-dimmed">Declare provider projects and exact OpenAPI sources Archie may use for compatibility review.</p></div>
          <button onClick={() => { setShowDependencyForm(true); setProviderAppId(availableProviders[0] ? String(availableProviders[0].id) : ""); }} disabled={!availableProviders.length} className="flex items-center gap-1 rounded-lg border border-th px-2.5 py-1.5 text-xs text-th-secondary disabled:opacity-50"><Plus size={13} />Add</button>
        </div>
        {showDependencyForm && (
          <form onSubmit={createDependency} className="mt-3 space-y-2.5 rounded-lg border border-th bg-th-subtle p-3">
            <label className="block text-xs text-th-secondary">Provider project<select required value={providerAppId} onChange={(event) => setProviderAppId(event.target.value)} className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary"><option value="">Choose a project...</option>{availableProviders.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-2.5"><label className="text-xs text-th-secondary">Authoritative reference<input required value={authoritativeRef} onChange={(event) => setAuthoritativeRef(event.target.value)} className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary" /></label><label className="text-xs text-th-secondary">OpenAPI source path<input required value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary" /></label></div>
            <label className="block text-xs text-th-secondary">Version expectation<input value={versionExpectation} onChange={(event) => setVersionExpectation(event.target.value)} placeholder="Backward compatible within v1" className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary" /></label>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowDependencyForm(false)} className="px-2.5 py-1.5 text-xs text-th-muted">Cancel</button><button type="submit" disabled={savingDependency} className="rounded-lg bg-btn-secondary px-3 py-1.5 text-xs text-btn-secondary disabled:opacity-50">{savingDependency ? "Saving..." : "Save contract"}</button></div>
          </form>
        )}
        <div className="mt-3 space-y-2">
          {dependencies.length === 0 ? <div className="rounded-lg border border-dashed border-th px-3 py-3 text-xs text-th-dimmed">No approved review contracts configured.</div> : dependencies.map((dependency) => (
            <div key={dependency.id} className="flex items-start gap-2 rounded-lg border border-th bg-th-surface p-3"><div className="min-w-0 flex-1"><div className="text-sm font-medium text-th-primary">{dependency.provider_name || `Project ${dependency.provider_app_id}`}</div><p className="mt-1 truncate font-mono text-xs text-th-secondary">{dependency.source_path}@{dependency.authoritative_ref}</p><p className="mt-1 text-meta text-th-dimmed">{dependency.state === "active" ? "Used for API compatibility review" : "Paused"}{dependency.version_expectation ? ` · ${dependency.version_expectation}` : ""}</p></div><button disabled={mutatingDependencyId === dependency.id} onClick={() => toggleDependency(dependency)} className="px-2 py-1 text-xs text-th-muted hover:text-th-primary disabled:opacity-50">{dependency.state === "active" ? "Pause" : "Resume"}</button><button disabled={mutatingDependencyId === dependency.id} onClick={() => removeDependency(dependency)} aria-label={`Delete ${dependency.provider_name || "dependency"}`} className="p-1.5 text-th-muted hover:text-st-red disabled:opacity-50"><Trash size={14} /></button></div>
          ))}
        </div>
      </div>
      {message && <div className={`rounded-lg px-3 py-2 text-xs ${message.type === "success" ? "bg-st-green text-st-green" : "bg-st-red text-st-red"}`}>{message.text}</div>}
    </div>
  );
}
