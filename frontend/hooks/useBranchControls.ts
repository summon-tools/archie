"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import useSWR from "swr";
import { Task, GitStatus } from "@/lib/types";
import {
  removeWorktree,
  pushWorktreeBranch,
  createWorktreePR,
  updateWorktreePR,
  rebaseWorktreeFromMain,
} from "@/lib/api";
import { fetcher } from "@/lib/swr";

function parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  // HTTPS format: https://github.com/owner/repo(.git)
  const httpsMatch = remoteUrl.match(/https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  return null;
}

interface UseBranchControlsOptions {
  appId: number;
  workItem: Task;
  onItemUpdate: () => void;
}

export function useBranchControls({
  appId,
  workItem,
  onItemUpdate,
}: UseBranchControlsOptions) {
  const [removingBranch, setRemovingBranch] = useState(false);
  const [confirmRemoveBranch, setConfirmRemoveBranch] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [creatingPR, setCreatingPR] = useState(false);
  const [updatingPR, setUpdatingPR] = useState(false);
  const [rebasing, setRebasing] = useState(false);
  const [prResult, setPrResult] = useState<{ pr_url: string; pr_number: number } | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);

  // Poll git status when there's a worktree OR a branch (e.g. setup tasks work on
  // the app directory directly without a worktree)
  const { data: worktreeGitStatus, mutate: refetchGitStatus } = useSWR<GitStatus>(
    (workItem.worktree_dir || workItem.branch_name) ? `/api/apps/${appId}/work-items/${workItem.id}/env/git-status` : null,
    fetcher,
  );

  // Initialize prResult from task DB fields
  useEffect(() => {
    if (workItem.pr_url && workItem.pr_number) {
      setPrResult({ pr_url: workItem.pr_url, pr_number: workItem.pr_number });
    }
  }, [workItem.pr_url, workItem.pr_number]);

  const handleRemoveBranch = useCallback(async () => {
    if (!confirmRemoveBranch) {
      setConfirmRemoveBranch(true);
      setTimeout(() => setConfirmRemoveBranch(false), 3000);
      return;
    }
    setRemovingBranch(true);
    setBranchError(null);
    try {
      await removeWorktree(appId, workItem.id);
      onItemUpdate();
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : "Failed to remove branch");
    } finally {
      setRemovingBranch(false);
      setConfirmRemoveBranch(false);
    }
  }, [appId, workItem.id, confirmRemoveBranch, onItemUpdate]);

  const handlePushBranch = useCallback(async () => {
    setPushing(true);
    setBranchError(null);
    try {
      const result = await pushWorktreeBranch(appId, workItem.id);
      if (!result.success) {
        setBranchError(result.message || "Push failed");
      } else {
        await refetchGitStatus();
      }
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : "Failed to push branch");
    } finally {
      setPushing(false);
    }
  }, [appId, workItem.id, refetchGitStatus]);

  // prUrl is kept for the button visibility check (confirms remote is GitHub)
  const prUrl = useMemo(() => {
    if (!worktreeGitStatus?.remote_url || !workItem.branch_name) return null;
    const parsed = parseGitHubUrl(worktreeGitStatus.remote_url);
    if (!parsed) return null;
    return `https://github.com/${parsed.owner}/${parsed.repo}`;
  }, [worktreeGitStatus?.remote_url, workItem.branch_name]);

  const handleCreatePR = useCallback(async () => {
    if (!worktreeGitStatus?.remote_url) {
      setBranchError("No remote URL configured");
      return;
    }
    if (!prUrl) {
      setBranchError("Remote URL is not a GitHub repository");
      return;
    }
    setCreatingPR(true);
    setBranchError(null);
    try {
      const result = await createWorktreePR(appId, workItem.id);
      if (result.success) {
        setPrResult({ pr_url: result.pr_url, pr_number: result.pr_number });
      } else {
        setBranchError(result.message || "Failed to create PR");
      }
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : "Failed to create PR");
    } finally {
      setCreatingPR(false);
    }
  }, [appId, workItem.id, worktreeGitStatus?.remote_url, prUrl]);

  const handleRebaseFromMain = useCallback(async () => {
    setRebasing(true);
    setBranchError(null);
    try {
      const result = await rebaseWorktreeFromMain(appId, workItem.id);
      if (!result.success) {
        setBranchError(result.message || "Rebase failed");
      } else {
        await refetchGitStatus();
      }
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : "Failed to rebase from main");
    } finally {
      setRebasing(false);
    }
  }, [appId, workItem.id, refetchGitStatus]);

  const handleUpdatePR = useCallback(async () => {
    if (!prResult) {
      setBranchError("No PR exists yet. Create one first.");
      return;
    }
    setUpdatingPR(true);
    setBranchError(null);
    try {
      const result = await updateWorktreePR(appId, workItem.id);
      if (!result.success) {
        setBranchError(result.message || "Failed to update PR");
      } else if (result.message.includes("video:")) {
        setBranchError(result.message);
      }
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : "Failed to update PR");
    } finally {
      setUpdatingPR(false);
    }
  }, [appId, workItem.id, prResult]);

  // Smart publish: push if needed, then create or update PR
  const [publishing, setPublishing] = useState(false);
  const handlePublish = useCallback(async () => {
    setPublishing(true);
    setBranchError(null);
    try {
      const needsPush = worktreeGitStatus && (worktreeGitStatus.unpushed_count > 0 || worktreeGitStatus.uncommitted_count > 0);
      const hasPR = !!prResult;

      // Step 1: Push if there are unpushed commits
      if (needsPush) {
        const pushResult = await pushWorktreeBranch(appId, workItem.id);
        if (!pushResult.success) {
          setBranchError(pushResult.message || "Push failed");
          return;
        }
        await refetchGitStatus();
      }

      // Step 2: Create PR or update PR description
      if (!hasPR) {
        if (!worktreeGitStatus?.remote_url) {
          setBranchError("No remote URL configured");
          return;
        }
        if (!prUrl) {
          setBranchError("Remote URL is not a GitHub repository");
          return;
        }
        const createResult = await createWorktreePR(appId, workItem.id);
        if (createResult.success) {
          setPrResult({ pr_url: createResult.pr_url, pr_number: createResult.pr_number });
        } else {
          setBranchError(createResult.message || "Failed to create PR");
        }
      } else {
        const updateResult = await updateWorktreePR(appId, workItem.id);
        if (!updateResult.success) {
          setBranchError(updateResult.message || "Failed to update PR");
        } else if (updateResult.message.includes("video:")) {
          setBranchError(updateResult.message);
        }
      }
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setPublishing(false);
    }
  }, [appId, workItem.id, worktreeGitStatus, prResult, prUrl, refetchGitStatus]);

  return {
    removeBranch: handleRemoveBranch,
    pushBranch: handlePushBranch,
    createPR: handleCreatePR,
    updatePR: handleUpdatePR,
    publish: handlePublish,
    rebaseFromMain: handleRebaseFromMain,
    pushing,
    creatingPR,
    updatingPR,
    publishing,
    rebasing,
    prResult,
    removingBranch,
    confirmRemoveBranch,
    worktreeGitStatus: worktreeGitStatus ?? null,
    prUrl,
    branchError,
    setBranchError,
  };
}
