"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import {
  GitPullRequest,
  ArrowSquareOut,
  ArrowDown,
  CheckCircle,
  SpinnerGap,
  ArrowRight,
  FolderOpen,
} from "@phosphor-icons/react";

interface SetupNextStepsProps {
  appId: number;
  workItemId: number;
  branchName: string | null;
  prResult: { pr_url: string; pr_number: number } | null;
  pushing: boolean;
  creatingPR: boolean;
  publishing: boolean;
  onPublish: () => void;
  onPull: () => void;
  pulling: boolean;
  branchError: string | null;
  prUrl: string | null;
  onMarkDone: () => void;
  markedDone: boolean;
}

interface PRStatus {
  state: "OPEN" | "CLOSED" | "MERGED" | "unknown";
  pr_url?: string;
  pr_number?: number;
}

export default function SetupNextSteps({
  appId,
  workItemId,
  branchName,
  prResult,
  pushing,
  creatingPR,
  publishing,
  onPublish,
  onPull,
  pulling,
  branchError,
  prUrl,
  onMarkDone,
  markedDone,
}: SetupNextStepsProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Poll PR merge status when a PR exists
  const { data: prStatus } = useSWR<PRStatus>(
    prResult ? `/api/apps/${appId}/work-items/${workItemId}/env/pr-status` : null,
    fetcher,
    { refreshInterval: 10000 }, // poll every 10s
  );

  const isMerged = prStatus?.state === "MERGED";

  if (markedDone) {
    return (
      <div className="bg-st-green/10 border border-st-green/20 rounded-xl px-5 py-4 flex items-center gap-3">
        <CheckCircle size={20} weight="bold" className="text-st-green flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-th-primary">Setup complete</p>
          <p className="text-xs text-th-dimmed mt-0.5">
            Your app is ready to go. Create a new conversation to start working on tasks.
          </p>
        </div>
      </div>
    );
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-full text-left px-4 py-3 bg-th-subtle border border-th rounded-xl text-sm text-th-secondary hover:bg-th-muted transition-colors"
      >
        <span className="font-medium">Next steps</span>
        <span className="text-th-dimmed ml-2">
          {isMerged ? "— PR merged, pull changes to sync" : "— push and merge the setup branch"}
        </span>
      </button>
    );
  }

  const hasPR = !!prResult;
  const isBusy = pushing || creatingPR || publishing;

  return (
    <div className="bg-th-subtle border border-th rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-th">
        <div className="flex items-center gap-2">
          <ArrowRight size={16} weight="bold" className="text-st-blue" />
          <h3 className="text-sm font-semibold text-th-primary">Next steps</h3>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-xs text-th-dimmed hover:text-th-secondary transition-colors"
        >
          Collapse
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Explanation */}
        {!isMerged && (
          <p className="text-sm text-th-secondary">
            Setup is complete! All changes are on the <code className="bg-th-code px-1.5 py-0.5 rounded text-xs font-mono">{branchName || "setup-archie"}</code> branch — your main branch is untouched.
            To finalize, push the branch and merge the pull request.
          </p>
        )}

        {isMerged && (
          <p className="text-sm text-th-secondary">
            The setup PR has been merged. Pull the changes to sync your local repo, then mark this task as done.
          </p>
        )}

        {/* Steps */}
        <div className="space-y-3">
          {/* Step 1: Push & Create PR */}
          {!hasPR && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-st-blue/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-st-blue">1</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-th-primary">Push branch & create pull request</p>
                <p className="text-xs text-th-dimmed mt-0.5">
                  Pushes the <code className="bg-th-code px-1 py-0.5 rounded">{branchName || "setup-archie"}</code> branch to GitHub and opens a PR.
                </p>
                <button
                  onClick={onPublish}
                  disabled={isBusy || !prUrl}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isBusy ? (
                    <>
                      <SpinnerGap size={14} className="animate-spin" />
                      {pushing ? "Pushing..." : "Creating PR..."}
                    </>
                  ) : (
                    <>
                      <GitPullRequest size={14} weight="bold" />
                      Push & Create PR
                    </>
                  )}
                </button>
                {!prUrl && (
                  <p className="text-xs text-st-amber mt-1.5">
                    No GitHub remote detected. Push manually with <code className="bg-th-code px-1 py-0.5 rounded">git push -u origin {branchName || "setup-archie"}</code>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 1 complete: PR created */}
          {hasPR && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-st-green/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle size={16} weight="bold" className="text-st-green" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-th-primary">
                  Pull request {isMerged ? "merged" : "created"}
                </p>
                <a
                  href={prResult.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-st-blue hover:underline mt-0.5"
                >
                  PR #{prResult.pr_number} {isMerged && <span className="text-st-green">(merged)</span>}
                  <ArrowSquareOut size={12} />
                </a>
              </div>
            </div>
          )}

          {/* Step 2: Merge (or already merged) */}
          {!isMerged && (
            <div className="flex items-start gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${hasPR ? "bg-st-blue/15" : "bg-th-muted"}`}>
                <span className={`text-xs font-bold ${hasPR ? "text-st-blue" : "text-th-dimmed"}`}>2</span>
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${hasPR ? "text-th-primary" : "text-th-dimmed"}`}>
                  Review & merge the PR in GitHub
                </p>
                <p className="text-xs text-th-dimmed mt-0.5">
                  Review the changes, then merge to add the Archie configuration to your main branch.
                </p>
                {hasPR && (
                  <a
                    href={prResult.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover transition-colors border border-th"
                  >
                    <ArrowSquareOut size={14} />
                    Open PR on GitHub
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Step 2 complete: Merged */}
          {isMerged && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-st-green/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle size={16} weight="bold" className="text-st-green" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-th-primary">PR merged</p>
              </div>
            </div>
          )}

          {/* Step 3: Pull changes (shown after merge) */}
          {isMerged && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-st-blue/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-st-blue">3</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-th-primary">Pull changes & mark as done</p>
                <p className="text-xs text-th-dimmed mt-0.5">
                  Sync your local main branch with the merged changes, then mark this setup task as done.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={onPull}
                    disabled={pulling}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {pulling ? (
                      <>
                        <SpinnerGap size={14} className="animate-spin" />
                        Pulling...
                      </>
                    ) : (
                      <>
                        <ArrowDown size={14} weight="bold" />
                        Pull from GitHub
                      </>
                    )}
                  </button>
                  <button
                    onClick={onMarkDone}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover transition-colors border border-th"
                  >
                    <CheckCircle size={14} weight="bold" />
                    Complete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {branchError && (
          <p className="text-xs text-st-red bg-st-red/10 border border-st-red/20 rounded-lg px-3 py-2">
            {branchError}
          </p>
        )}

        {/* Folder explanation */}
        {!isMerged && (
          <div className="border-t border-th pt-3 mt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <FolderOpen size={14} className="text-th-secondary" />
              <p className="text-xs font-medium text-th-secondary">What was added to your repo</p>
            </div>
            <div className="grid gap-1.5 text-xs text-th-dimmed">
              <div><code className="bg-th-code px-1 py-0.5 rounded">.archie/app.yaml</code> — Runtime manifest: how Archie starts, installs, and manages your app</div>
              <div><code className="bg-th-code px-1 py-0.5 rounded">.archie/skills/</code> — Team conventions and playbooks</div>
              <div><code className="bg-th-code px-1 py-0.5 rounded">.gitignore</code> — Updated to exclude runtime files (logs, pids)</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
