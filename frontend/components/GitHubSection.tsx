"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { GithubLogo, Gear, SpinnerGap, ArrowDown } from "@phosphor-icons/react";
import { GitStatus } from "@/lib/types";
import { setGitRemote, pullFromGitHub, initGit } from "@/lib/api";
import { fetcher } from "@/lib/swr";

interface GitHubSectionProps {
  appId: number;
  githubRepo: string;
}

export default function GitHubSection({
  appId,
  githubRepo,
}: GitHubSectionProps) {
  const { data: gitStatus, isLoading: loading, mutate: reloadStatus } = useSWR<GitStatus>(
    `/api/apps/${appId}/git/status`,
    fetcher,
  );
  const [pullLoading, setPullLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [showRepoForm, setShowRepoForm] = useState(false);
  const [repoUrl, setRepoUrl] = useState(githubRepo);
  const [savingRemote, setSavingRemote] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const handleInit = async () => {
    setInitLoading(true);
    try {
      await initGit(appId);
      setMessage({ type: "success", text: "Git repository initialized" });
      reloadStatus();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Init failed",
      });
    } finally {
      setInitLoading(false);
    }
  };

  const handleSetRemote = async () => {
    if (!repoUrl.trim()) return;
    setSavingRemote(true);
    try {
      await setGitRemote(appId, repoUrl.trim());
      setShowRepoForm(false);
      setMessage({ type: "success", text: "GitHub repo connected" });
      reloadStatus();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to set remote",
      });
    } finally {
      setSavingRemote(false);
    }
  };

  const handlePull = async () => {
    setPullLoading(true);
    setMessage(null);
    try {
      const result = await pullFromGitHub(appId);
      setMessage({
        type: "success",
        text: result.message,
      });
      reloadStatus();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Pull failed",
      });
    } finally {
      setPullLoading(false);
    }
  };

  // Extract short repo name from URL (e.g., "git@github.com:user/repo.git" -> "user/repo")
  const shortRepoName = (url: string) => {
    const match = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : url;
  };

  if (loading) {
    return (
      <div className="mb-6 bg-th-subtle rounded-xl border border-th p-4 animate-pulse">
        <div className="h-5 bg-th-muted rounded w-32" />
      </div>
    );
  }

  // GitHub icon
  const GitHubIcon = () => (
    <GithubLogo size={20} weight="fill" />
  );

  // State 1: Not initialized
  if (!gitStatus?.initialized) {
    return (
      <div className="mb-6 bg-th-subtle rounded-xl border border-th p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-th-muted">
            <GitHubIcon />
            <span className="text-sm font-medium text-th-secondary">Git not initialized</span>
          </div>
          <button
            onClick={handleInit}
            disabled={initLoading}
            className="px-3 py-1.5 text-sm bg-btn-ghost-hover text-btn-ghost rounded-lg hover:bg-btn-secondary-hover hover:text-btn-secondary disabled:opacity-50 font-medium"
          >
            {initLoading ? "Initializing..." : "Initialize Git"}
          </button>
        </div>
        {message && (
          <div
            className={`mt-3 text-sm px-3 py-2 rounded-lg ${
              message.type === "success"
                ? "bg-st-green text-st-green"
                : "bg-st-red text-st-red"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
    );
  }

  // State 2: Initialized but no remote
  if (!gitStatus?.has_remote) {
    return (
      <div className="mb-6 bg-th-subtle rounded-xl border border-th p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-th-muted">
            <GitHubIcon />
            <span className="text-sm font-medium text-th-secondary">Not connected to GitHub</span>
          </div>
          {!showRepoForm && (
            <button
              onClick={() => setShowRepoForm(true)}
              className="px-3 py-1.5 text-sm bg-btn-ghost-hover text-btn-ghost rounded-lg hover:bg-btn-secondary-hover hover:text-btn-secondary font-medium"
            >
              Connect to GitHub
            </button>
          )}
        </div>

        {showRepoForm && (
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="github.com/user/repo or git@github.com:user/repo.git"
              className="flex-1 px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter" && repoUrl.trim()) handleSetRemote();
              }}
            />
            <button
              onClick={handleSetRemote}
              disabled={savingRemote || !repoUrl.trim()}
              className="px-4 py-2 bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover disabled:opacity-50 text-sm font-medium"
            >
              {savingRemote ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setShowRepoForm(false)}
              className="px-3 py-2 text-sm text-th-muted hover:text-th-primary"
            >
              Cancel
            </button>
          </div>
        )}

        {message && (
          <div
            className={`mt-3 text-sm px-3 py-2 rounded-lg ${
              message.type === "success"
                ? "bg-st-green text-st-green"
                : "bg-st-red text-st-red"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
    );
  }

  // State 3: Connected to GitHub
  return (
    <div className="mb-6 bg-th-surface rounded-xl border border-th p-3 space-y-2.5">
      {/* Row 1: Repo name + settings */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-th-secondary min-w-0">
          <GitHubIcon />
          <a
            href={`https://github.com/${shortRepoName(gitStatus.remote_url)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium hover:text-th-primary hover:underline truncate"
          >
            {shortRepoName(gitStatus.remote_url)}
          </a>
        </div>
        <button
          onClick={() => {
            setShowRepoForm(!showRepoForm);
            setRepoUrl(gitStatus.remote_url);
          }}
          className="p-2 text-th-dimmed hover:text-th-primary flex-shrink-0"
          title="Change remote"
        >
          <Gear size={14} weight="bold" />
        </button>
      </div>

      {/* Row 2: Status + last commit */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${gitStatus.has_changes ? "bg-yellow-500" : "bg-green-500"}`} />
        <span className="text-xs text-th-dimmed">
          {gitStatus.has_changes ? "Uncommitted changes" : "Clean"}
        </span>
        {gitStatus.behind_count > 0 && (
          <>
            <span className="text-th-secondary text-xs">·</span>
            <span className="text-xs text-st-amber font-medium">
              {gitStatus.behind_count} commit{gitStatus.behind_count !== 1 ? "s" : ""} behind
            </span>
          </>
        )}
        {gitStatus.last_commit_message && (
          <>
            <span className="text-th-secondary text-xs">·</span>
            <span className="text-xs text-th-muted truncate" title={gitStatus.last_commit_message}>
              {gitStatus.last_commit_message}
            </span>
          </>
        )}
      </div>

      {/* Row 3: Sync/Pull button (always visible when connected) */}
      <button
        onClick={handlePull}
        disabled={pullLoading}
        className="w-full px-3 py-1.5 text-xs bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover disabled:opacity-50 font-medium flex items-center justify-center gap-1.5"
      >
        {pullLoading ? (
          <>
            <SpinnerGap size={14} className="animate-spin" />
            Pulling...
          </>
        ) : gitStatus.behind_count > 0 ? (
          <>
            <ArrowDown size={14} weight="bold" />
            Pull {gitStatus.behind_count} commit{gitStatus.behind_count !== 1 ? "s" : ""} from GitHub
          </>
        ) : (
          <>
            <ArrowDown size={14} weight="bold" />
            Sync from GitHub
          </>
        )}
      </button>

      {/* Change remote form (toggle) */}
      {showRepoForm && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="github.com/user/repo or git@github.com:user/repo.git"
            className="flex-1 px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter" && repoUrl.trim()) handleSetRemote();
            }}
          />
          <button
            onClick={handleSetRemote}
            disabled={savingRemote || !repoUrl.trim()}
            className="px-4 py-2 bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingRemote ? "Saving..." : "Update"}
          </button>
          <button
            onClick={() => setShowRepoForm(false)}
            className="px-3 py-2 text-sm text-th-dimmed hover:text-th-primary"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Status message */}
      {message && (
        <div
          className={`mt-3 text-sm px-3 py-2 rounded-lg ${
            message.type === "success"
              ? "bg-st-green text-st-green"
              : "bg-st-red text-st-red"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
