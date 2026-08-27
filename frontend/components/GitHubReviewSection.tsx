"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowsClockwise, GithubLogo, LinkSimple, Plus, SpinnerGap } from "@phosphor-icons/react";
import {
  connectGitHubProjectRepository,
  getGitHubAppInstallations,
  getGitHubProjectRepositories,
  type GitHubAppInstallation,
  type GitHubProjectRepository,
} from "@/lib/api";

interface GitHubReviewSectionProps {
  appId: number;
  githubRepo: string;
}

interface RepositoryDraft {
  installation_id: string;
  owner: string;
  repo: string;
  default_branch: string;
}

function parseGitHubRepository(value: string): { owner: string; repo: string } {
  const normalized = value.trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
  const [owner = "", repo = ""] = normalized.split("/");
  return { owner, repo };
}

function draftFromRepository(repository: GitHubProjectRepository | undefined, githubRepo: string): RepositoryDraft {
  const parsed = parseGitHubRepository(githubRepo);
  return {
    installation_id: repository ? String(repository.installation_id) : "",
    owner: repository?.owner || parsed.owner,
    repo: repository?.repo || parsed.repo,
    default_branch: repository?.default_branch || "main",
  };
}

export default function GitHubReviewSection({ appId, githubRepo }: GitHubReviewSectionProps) {
  const [repository, setRepository] = useState<GitHubProjectRepository | undefined>();
  const [installations, setInstallations] = useState<GitHubAppInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<RepositoryDraft>(() => draftFromRepository(undefined, githubRepo));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    getGitHubProjectRepositories()
      .then((repositories) => {
        const current = repositories.find((item) => item.app_id === appId);
        setRepository(current);
        setDraft(draftFromRepository(current, githubRepo));
      })
      .catch((error) => setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load GitHub review connection" }))
      .finally(() => setLoading(false));
  }, [appId, githubRepo]);

  const openForm = async () => {
    setMessage(null);
    setShowForm(true);
    setLoadingInstallations(true);
    try {
      const available = await getGitHubAppInstallations();
      setInstallations(available);
      setDraft((current) => ({
        ...current,
        installation_id: current.installation_id || (available[0] ? String(available[0].installation_id) : ""),
      }));
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load GitHub App installations" });
    } finally {
      setLoadingInstallations(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setDraft(draftFromRepository(repository, githubRepo));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = installations.find((item) => item.installation_id === Number(draft.installation_id));
    if (!selected) {
      setMessage({ type: "error", text: "Choose a GitHub App installation." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const connected = await connectGitHubProjectRepository({
        app_id: appId,
        installation_id: selected.installation_id,
        account_login: selected.account_login,
        account_type: selected.account_type,
        owner: draft.owner.trim(),
        repo: draft.repo.trim(),
        default_branch: draft.default_branch.trim() || "main",
      });
      setRepository(connected);
      setDraft(draftFromRepository(connected, githubRepo));
      setShowForm(false);
      setMessage({ type: "success", text: "GitHub App review connection saved." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save GitHub review connection" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-th pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-th-muted">GitHub App reviews</h4>
          <p className="mt-1 text-meta text-th-dimmed">
            Connect this existing Archie project to the repository where it should receive review requests.
          </p>
        </div>
        {!loading && (
          <button
            onClick={openForm}
            className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-th px-2.5 py-1.5 text-xs font-medium text-th-secondary hover:border-th-strong hover:text-th-primary"
          >
            {repository ? <ArrowsClockwise size={13} weight="bold" /> : <Plus size={13} weight="bold" />}
            {repository ? "Change" : "Connect"}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-2.5 rounded-lg border border-th bg-th-subtle p-3">
          <label className="block text-xs text-th-secondary">
            GitHub App installation
            <select
              value={draft.installation_id}
              onChange={(event) => setDraft((current) => ({ ...current, installation_id: event.target.value }))}
              required
              disabled={loadingInstallations || installations.length === 0}
              className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary focus:border-brand-400 focus:outline-none disabled:opacity-60"
            >
              <option value="">{loadingInstallations ? "Loading installations..." : "Choose an installation..."}</option>
              {installations.map((installation) => (
                <option key={installation.installation_id} value={installation.installation_id}>
                  {installation.account_login}{installation.account_type ? ` (${installation.account_type})` : ""}
                </option>
              ))}
            </select>
            {installations.length === 0 && !loadingInstallations && (
              <span className="mt-1 block text-meta text-st-amber">Install Personal Archie on GitHub first.</span>
            )}
          </label>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-xs text-th-secondary">
              Repository owner
              <input
                value={draft.owner}
                onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}
                placeholder="your-account"
                required
                maxLength={255}
                className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary focus:border-brand-400 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-th-secondary">
              Repository name
              <input
                value={draft.repo}
                onChange={(event) => setDraft((current) => ({ ...current, repo: event.target.value }))}
                placeholder="my-repository"
                required
                maxLength={255}
                className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary focus:border-brand-400 focus:outline-none"
              />
            </label>
          </div>

          <label className="block text-xs text-th-secondary">
            Default branch
            <input
              value={draft.default_branch}
              onChange={(event) => setDraft((current) => ({ ...current, default_branch: event.target.value }))}
              placeholder="main"
              required
              maxLength={255}
              className="mt-1 w-full rounded-lg border border-th bg-transparent px-2.5 py-1.5 text-sm text-th-primary focus:border-brand-400 focus:outline-none"
            />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeForm} className="px-2.5 py-1.5 text-xs text-th-muted hover:text-th-primary">Cancel</button>
            <button
              type="submit"
              disabled={saving || loadingInstallations || installations.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-btn-secondary px-3 py-1.5 text-xs font-medium text-btn-secondary hover:bg-btn-secondary-hover disabled:opacity-50"
            >
              {saving && <SpinnerGap size={12} className="animate-spin" />}
              Save connection
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-th-muted"><SpinnerGap size={13} className="animate-spin" /> Loading...</div>
      ) : repository ? (
        <div className="mt-3 rounded-lg border border-th bg-th-surface p-3">
          <div className="flex items-start gap-2">
            <GithubLogo size={17} weight="fill" className="mt-0.5 flex-shrink-0 text-th-muted" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-th-primary">{repository.owner}/{repository.repo}</span>
                <span className="rounded bg-st-green px-1.5 py-0.5 text-meta text-st-green">Active</span>
              </div>
              <p className="mt-1 text-xs text-th-dimmed">Installation {repository.installation_id} · default branch {repository.default_branch}</p>
            </div>
            <LinkSimple size={14} className="mt-1 flex-shrink-0 text-st-green" />
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-th px-3 py-3 text-xs text-th-dimmed">
          This project is not connected to a GitHub App review repository yet.
        </div>
      )}

      {message && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${message.type === "success" ? "bg-st-green text-st-green" : "bg-st-red text-st-red"}`}>
          {message.text}
        </div>
      )}

    </div>
  );
}
