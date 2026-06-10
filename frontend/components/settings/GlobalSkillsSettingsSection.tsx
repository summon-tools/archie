"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Lightning, Plus, SpinnerGap, Trash } from "@phosphor-icons/react";
import type { GlobalSkill } from "@/lib/types";
import {
  createGlobalSkill,
  deleteGlobalSkill,
  fetchGlobalSkillsAdmin,
  updateGlobalSkill,
  type GlobalSkillPayload,
} from "@/lib/api";

interface GlobalSkillsSettingsSectionProps {
  onNotify?: (type: "success" | "error", message: string) => void;
}

interface SkillDraft {
  originalSlug: string | null;
  slug: string;
  name: string;
  description: string;
  body_md: string;
  triggerText: string;
  enabled: boolean;
}

const EMPTY_DRAFT: SkillDraft = {
  originalSlug: null,
  slug: "",
  name: "",
  description: "",
  body_md: "",
  triggerText: "",
  enabled: true,
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function draftFromSkill(skill: GlobalSkill): SkillDraft {
  return {
    originalSlug: skill.slug,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    body_md: skill.body_md,
    triggerText: skill.trigger_phrases.join("\n"),
    enabled: skill.enabled,
  };
}

function payloadFromDraft(draft: SkillDraft): GlobalSkillPayload {
  return {
    slug: slugify(draft.slug),
    name: draft.name.trim(),
    description: draft.description.trim(),
    body_md: draft.body_md.trim(),
    trigger_phrases: draft.triggerText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    enabled: draft.enabled,
  };
}

export default function GlobalSkillsSettingsSection({ onNotify }: GlobalSkillsSettingsSectionProps) {
  const [skills, setSkills] = useState<GlobalSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<SkillDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteSlug, setConfirmDeleteSlug] = useState<string | null>(null);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.slug === draft.originalSlug) || null,
    [skills, draft.originalSlug],
  );

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGlobalSkillsAdmin();
      setSkills(data.skills);
      setDraft((current) => {
        if (current.originalSlug && data.skills.some((skill) => skill.slug === current.originalSlug)) {
          return current;
        }
        return data.skills[0] ? draftFromSkill(data.skills[0]) : EMPTY_DRAFT;
      });
    } catch (error) {
      onNotify?.("error", error instanceof Error ? error.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleSelectSkill = (skill: GlobalSkill) => {
    setConfirmDeleteSlug(null);
    setDraft(draftFromSkill(skill));
  };

  const handleNewSkill = () => {
    setConfirmDeleteSlug(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleSave = async () => {
    const payload = payloadFromDraft(draft);
    if (!payload.slug || !payload.name || !payload.description || !payload.body_md) return;

    setSaving(true);
    try {
      const result = draft.originalSlug
        ? await updateGlobalSkill(draft.originalSlug, payload)
        : await createGlobalSkill(payload);
      await loadSkills();
      setDraft(draftFromSkill(result.skill));
      onNotify?.("success", draft.originalSlug ? "Skill updated" : "Skill created");
    } catch (error) {
      onNotify?.("error", error instanceof Error ? error.message : "Failed to save skill");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (slug: string) => {
    try {
      await deleteGlobalSkill(slug);
      setConfirmDeleteSlug(null);
      onNotify?.("success", "Skill deleted");
      await loadSkills();
    } catch (error) {
      onNotify?.("error", error instanceof Error ? error.message : "Failed to delete skill");
    }
  };

  const canSave = Boolean(
    slugify(draft.slug) &&
    draft.name.trim() &&
    draft.description.trim() &&
    draft.body_md.trim() &&
    !saving,
  );

  return (
    <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-th-primary mb-1">Global Skills</h2>
          <p className="text-sm text-th-dimmed">
            Admin-defined skills are available across every app and can be called with slash commands.
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewSkill}
          className="inline-flex items-center gap-2 rounded-lg bg-btn-primary px-3 py-2 text-sm font-medium text-btn-primary hover:bg-btn-primary-hover"
        >
          <Plus size={14} weight="bold" />
          New skill
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-th bg-th-subtle px-3 py-4 text-sm text-th-muted">
          <SpinnerGap size={16} className="animate-spin" />
          Loading skills...
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="overflow-hidden rounded-xl border border-th">
            {skills.length === 0 ? (
              <div className="p-5 text-sm text-th-muted">
                No global skills yet.
              </div>
            ) : (
              <div className="divide-y divide-th">
                {skills.map((skill) => (
                  <button
                    key={skill.slug}
                    type="button"
                    onClick={() => handleSelectSkill(skill)}
                    className={`w-full px-3 py-3 text-left transition-colors ${
                      draft.originalSlug === skill.slug
                        ? "bg-th-muted"
                        : "hover:bg-th-subtle"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Lightning size={14} weight="bold" className="text-th-muted" />
                      <span className="truncate text-sm font-medium text-th-primary">{skill.name}</span>
                      {!skill.enabled && (
                        <span className="ml-auto rounded-full bg-th-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase text-th-dimmed">
                          off
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-xs text-th-dimmed">/{skill.slug}</div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-th-muted">{skill.description}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_180px]">
              <div>
                <label className="mb-1 block text-sm font-medium text-th-secondary">Name</label>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                    slug: current.originalSlug || current.slug ? current.slug : slugify(event.target.value),
                  }))}
                  className="w-full rounded-lg border border-th bg-th-subtle px-3 py-2 text-sm text-th-primary focus:border-transparent focus:ring-2 focus:ring-th"
                  placeholder="Review working tree"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-th-secondary">Slash command</label>
                <div className="flex items-center rounded-lg border border-th bg-th-subtle px-3 py-2 focus-within:ring-2 focus-within:ring-th">
                  <span className="font-mono text-sm text-th-dimmed">/</span>
                  <input
                    value={draft.slug}
                    onChange={(event) => setDraft((current) => ({ ...current, slug: slugify(event.target.value) }))}
                    className="min-w-0 flex-1 border-none bg-transparent font-mono text-sm text-th-primary focus:outline-none focus:ring-0"
                    placeholder="review"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-th-secondary">Description</label>
              <input
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                className="w-full rounded-lg border border-th bg-th-subtle px-3 py-2 text-sm text-th-primary focus:border-transparent focus:ring-2 focus:ring-th"
                placeholder="Use for code reviews, regressions, and missing tests."
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-th-secondary">Trigger phrases</label>
              <textarea
                value={draft.triggerText}
                onChange={(event) => setDraft((current) => ({ ...current, triggerText: event.target.value }))}
                rows={3}
                className="w-full resize-y rounded-lg border border-th bg-th-subtle px-3 py-2 text-sm text-th-primary focus:border-transparent focus:ring-2 focus:ring-th"
                placeholder={"review this\ncheck my changes\ndeep review"}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-th-secondary">Instructions</label>
              <textarea
                value={draft.body_md}
                onChange={(event) => setDraft((current) => ({ ...current, body_md: event.target.value }))}
                rows={12}
                className="w-full resize-y rounded-lg border border-th bg-th-subtle px-3 py-2 font-mono text-sm leading-6 text-th-primary focus:border-transparent focus:ring-2 focus:ring-th"
                placeholder={"# Review Working Tree\n\nFindings first. Prioritize bugs, regressions, risky behavior, and missing tests."}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-th-secondary">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
                  className="h-4 w-4 rounded border-th bg-th-subtle"
                />
                Enabled
              </label>

              <div className="flex items-center gap-2">
                {selectedSkill && (
                  confirmDeleteSlug === selectedSkill.slug ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-xs text-st-red">Delete?</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(selectedSkill.slug)}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-st-red hover:bg-st-red-hover"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSlug(null)}
                        className="rounded-lg px-2 py-1 text-xs text-th-muted hover:bg-th-muted hover:text-th-primary"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSlug(selectedSkill.slug)}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-th-muted hover:bg-st-red-hover hover:text-st-red"
                    >
                      <Trash size={14} weight="bold" />
                      Delete
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className="inline-flex items-center gap-2 rounded-lg bg-btn-primary px-4 py-2 text-sm font-medium text-btn-primary hover:bg-btn-primary-hover disabled:opacity-50"
                >
                  {saving ? <SpinnerGap size={14} className="animate-spin" /> : <CheckCircle size={14} weight="bold" />}
                  {saving ? "Saving..." : "Save skill"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
