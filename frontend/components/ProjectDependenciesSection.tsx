"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, PencilSimple, Plus, SpinnerGap, Trash } from "@phosphor-icons/react";
import type { App, AppDependency } from "@/lib/types";
import {
  createAppDependency,
  deleteAppDependency,
  getAppDependencies,
  getApps,
  updateAppDependency,
} from "@/lib/api";

interface ProjectDependenciesSectionProps {
  appId: number;
}

type DependencyDraft = {
  dependency_app_id: string;
  role: string;
  purpose: string;
};

const EMPTY_DRAFT: DependencyDraft = {
  dependency_app_id: "",
  role: "",
  purpose: "",
};

function draftFromDependency(dependency: AppDependency): DependencyDraft {
  return {
    dependency_app_id: String(dependency.dependency_app_id),
    role: dependency.role,
    purpose: dependency.purpose,
  };
}

function DependencyForm({
  projects,
  draft,
  editing,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: {
  projects: App[];
  draft: DependencyDraft;
  editing: boolean;
  saving: boolean;
  onChange: (field: keyof DependencyDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2.5 rounded-lg border border-th bg-th-subtle p-3">
      <label className="block text-xs text-th-secondary">
        Dependency project
        <select
          value={draft.dependency_app_id}
          onChange={(event) => onChange("dependency_app_id", event.target.value)}
          disabled={editing}
          required
          className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary focus:border-brand-400 focus:outline-none disabled:opacity-60"
        >
          <option value="">Choose a project...</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-th-secondary">
        Role
        <input
          value={draft.role}
          onChange={(event) => onChange("role", event.target.value)}
          placeholder="Backend API"
          required
          maxLength={120}
          className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary focus:border-brand-400 focus:outline-none"
        />
      </label>
      <label className="block text-xs text-th-secondary">
        Relationship purpose
        <textarea
          value={draft.purpose}
          onChange={(event) => onChange("purpose", event.target.value)}
          placeholder="Read API contracts, routes, and schemas when implementing integrations."
          required
          maxLength={2000}
          rows={3}
          className="mt-1 w-full resize-y rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary focus:border-brand-400 focus:outline-none"
        />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-2.5 py-1.5 text-xs text-th-muted hover:text-th-primary">Cancel</button>
        <button
          type="submit"
          disabled={saving || (!editing && projects.length === 0)}
          className="flex items-center gap-1.5 rounded-lg bg-btn-secondary px-3 py-1.5 text-xs font-medium text-btn-secondary hover:bg-btn-secondary-hover disabled:opacity-50"
        >
          {saving && <SpinnerGap size={12} className="animate-spin" />}
          {editing ? "Save changes" : "Add dependency"}
        </button>
      </div>
    </form>
  );
}

export default function ProjectDependenciesSection({ appId }: ProjectDependenciesSectionProps) {
  const [dependencies, setDependencies] = useState<AppDependency[]>([]);
  const [projects, setProjects] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DependencyDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const availableProjects = useMemo(() => {
    const linkedIds = new Set(dependencies.map((dependency) => dependency.dependency_app_id));
    return projects.filter((project) => project.id !== appId && !linkedIds.has(project.id));
  }, [appId, dependencies, projects]);

  useEffect(() => {
    Promise.all([getAppDependencies(appId), getApps()])
      .then(([dependencyRows, appRows]) => {
        setDependencies(dependencyRows);
        setProjects(appRows);
      })
      .catch((error) => setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load project dependencies" }))
      .finally(() => setLoading(false));
  }, [appId]);

  const openCreateForm = () => {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, dependency_app_id: availableProjects[0] ? String(availableProjects[0].id) : "" });
    setMessage(null);
    setShowForm(true);
  };

  const openEditForm = (dependency: AppDependency) => {
    setEditingId(dependency.id);
    setDraft(draftFromDependency(dependency));
    setMessage(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      if (editingId) {
        const updated = await updateAppDependency(appId, editingId, {
          role: draft.role.trim(),
          purpose: draft.purpose.trim(),
        });
        setDependencies((current) => current.map((dependency) => dependency.id === updated.id ? updated : dependency));
        setMessage({ type: "success", text: "Dependency updated." });
      } else {
        const created = await createAppDependency(appId, {
          dependency_app_id: Number(draft.dependency_app_id),
          role: draft.role.trim(),
          purpose: draft.purpose.trim(),
        });
        setDependencies((current) => [...current, created].sort((a, b) => a.dependency_name.localeCompare(b.dependency_name)));
        setMessage({ type: "success", text: "Project dependency added." });
      }
      closeForm();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save project dependency" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (dependency: AppDependency) => {
    if (!window.confirm(`Remove ${dependency.dependency_name} as a dependency?`)) return;
    setDeletingId(dependency.id);
    setMessage(null);
    try {
      await deleteAppDependency(appId, dependency.id);
      setDependencies((current) => current.filter((item) => item.id !== dependency.id));
      if (editingId === dependency.id) closeForm();
      setMessage({ type: "success", text: "Project dependency removed." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to remove project dependency" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="border-t border-th pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-th-muted">Project dependencies</h4>
          <p className="mt-1 text-meta text-th-dimmed">
            Link other Archi projects and explain when their existing repository context should be used.
          </p>
        </div>
        <button
          onClick={openCreateForm}
          disabled={loading || availableProjects.length === 0}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-th px-2.5 py-1.5 text-xs font-medium text-th-secondary hover:border-th-strong hover:text-th-primary disabled:opacity-50"
        >
          <Plus size={13} weight="bold" />
          Add
        </button>
      </div>

      {showForm && (
        <DependencyForm
          projects={editingId ? projects.filter((project) => project.id === Number(draft.dependency_app_id)) : availableProjects}
          draft={draft}
          editing={editingId !== null}
          saving={saving}
          onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      )}

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-th-muted"><SpinnerGap size={13} className="animate-spin" /> Loading...</div>
      ) : dependencies.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-th px-3 py-3 text-xs text-th-dimmed">
          No project dependencies linked yet.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {dependencies.map((dependency) => (
            <div key={dependency.id} className="rounded-lg border border-th bg-th-surface p-3">
              <div className="flex items-start gap-2">
                <ArrowsClockwise size={17} className="mt-0.5 flex-shrink-0 text-th-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-th-primary">{dependency.dependency_name}</span>
                    <span className="truncate rounded bg-th-muted px-1.5 py-0.5 text-meta text-th-secondary">{dependency.role}</span>
                  </div>
                  <p className="mt-1 text-xs text-th-secondary">{dependency.purpose}</p>
                  {dependency.dependency_description && <p className="mt-1 truncate text-meta text-th-dimmed">{dependency.dependency_description}</p>}
                  {dependency.dependency_directory && <p className="mt-1 truncate font-mono text-meta text-th-dimmed" title={dependency.dependency_directory}>Uses: {dependency.dependency_directory}</p>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button onClick={() => openEditForm(dependency)} className="p-1.5 text-th-dimmed hover:text-th-primary" title="Edit dependency" aria-label={`Edit ${dependency.dependency_name}`}>
                    <PencilSimple size={14} />
                  </button>
                  <button onClick={() => handleDelete(dependency)} disabled={deletingId === dependency.id} className="p-1.5 text-th-dimmed hover:text-st-red disabled:opacity-50" title="Remove dependency" aria-label={`Remove ${dependency.dependency_name}`}>
                    {deletingId === dependency.id ? <SpinnerGap size={14} className="animate-spin" /> : <Trash size={14} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {message && <p className={`mt-2 text-xs ${message.type === "error" ? "text-st-red" : "text-st-green"}`}>{message.text}</p>}
    </div>
  );
}
