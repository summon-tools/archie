"use client";

import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import { Task } from "@/lib/types";
import { archiveConversation, classifyIntent, pullFromGitHub, sendConversationMessage, updateWorkItem, type ModelConfig } from "@/lib/api";
import { fetcher } from "@/lib/swr";
import { useBranchControls } from "@/hooks/useBranchControls";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useConversation } from "@/hooks/useConversation";
import ConversationHeader from "@/components/ConversationHeader";
import ConversationMessages from "@/components/ConversationMessages";
import ConversationInput from "@/components/ConversationInput";
import type { ToolContext, ToolState } from "@/tools/types";

interface ConversationViewProps {
  appId: number;
  workItem: Task;
  setWorkItem: (task: Task) => void;
  onItemUpdate: () => void;
  onItemDeleted: () => void;
  toolStates?: Map<string, ToolState>;
  toolContext?: ToolContext;
}

export default function ConversationView({
  appId,
  workItem,
  setWorkItem,
  onItemUpdate,
  onItemDeleted,
  toolStates,
  toolContext,
}: ConversationViewProps) {
  // Poll task while worktree is preparing
  useSWR<Task>(
    workItem.worktree_status === "preparing" ? `/api/apps/${appId}/work-items/${workItem.id}` : null,
    fetcher,
    {
      refreshInterval: 2000,
      onSuccess: (updated) => {
        if (updated.worktree_status !== "preparing") {
          setWorkItem(updated);
        }
      },
    },
  );

  const worktreeReady = workItem.worktree_status !== "preparing";

  // Fetch available models for the model picker
  const { data: modelConfig } = useSWR<ModelConfig>("/api/models/config", fetcher);

  // Mark as done state
  const [archiving, setArchiving] = useState(false);
  const [markedDone, setMarkedDone] = useState(false);

  // Header dropdown: mark as done and navigate away
  const handleArchive = useCallback(async () => {
    setArchiving(true);
    try {
      await archiveConversation(appId, workItem.primary_conversation_id!);
      onItemDeleted();
    } catch (err) {
      console.error("Failed to mark as done:", err);
      setArchiving(false);
    }
  }, [appId, workItem.primary_conversation_id, onItemDeleted]);

  // SetupNextSteps: mark as done and stay on page
  const handleMarkDone = useCallback(async () => {
    setArchiving(true);
    try {
      await archiveConversation(appId, workItem.primary_conversation_id!);
      setMarkedDone(true);
      onItemUpdate();
    } catch (err) {
      console.error("Failed to mark as done:", err);
    } finally {
      setArchiving(false);
    }
  }, [appId, workItem.primary_conversation_id, onItemUpdate]);

  // Rename handler
  const handleRename = useCallback(async (newTitle: string) => {
    try {
      const updated = await updateWorkItem(appId, workItem.id, { title: newTitle });
      setWorkItem(updated);
      onItemUpdate();
    } catch (err) {
      console.error("Failed to rename:", err);
    }
  }, [appId, workItem.id, setWorkItem, onItemUpdate]);

  // Pull from GitHub (used by SetupNextSteps after PR merge)
  const [pulling, setPulling] = useState(false);
  const handlePull = useCallback(async () => {
    setPulling(true);
    try {
      await pullFromGitHub(appId);
    } catch (err) {
      console.error("Failed to pull:", err);
    } finally {
      setPulling(false);
    }
  }, [appId]);

  // --- Hooks ---
  const { selectedModel, selectedProvider, handleModelChange } = useSelectedModel();

  const {
    pushBranch,
    createPR,
    updatePR,
    publish,
    pushing,
    creatingPR,
    updatingPR,
    publishing,
    prResult,
    worktreeGitStatus,
    prUrl,
    branchError,
  } = useBranchControls({ appId, workItem, onItemUpdate });

  const conversation = useConversation({
    appId,
    workItem,
    setWorkItem,
    onItemUpdate,
    selectedModel,
    selectedProvider,
  });

  const { autoScroll, setAutoScroll, logEndRef } = useAutoScroll([
    conversation.messages,
    conversation.streamContent,
  ]);

  // Cmd+Shift+G — commit & push
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "g") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        if (!pushing && !creatingPR && !updatingPR && workItem.branch_name) {
          pushBranch();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pushBranch, pushing, creatingPR, updatingPR, workItem.branch_name]);

  // Wire tool context's reloadMessages to the conversation's
  useEffect(() => {
    if (toolContext) {
      toolContext.reloadMessages = conversation.reloadMessages;
    }
  }, [toolContext, conversation.reloadMessages]);

  // Pinned tool: when user picks a tool from the dropdown, it stays
  // selected until they send a message (which uses that tool) or clear it.
  const [pinnedToolId, setPinnedToolId] = useState<string | null>(null);

  // Track whether we're in the middle of submitting (covers intent classification gap)
  const [submitting, setSubmitting] = useState(false);

  // Intent-aware message handler: if a tool is pinned, use it directly;
  // otherwise classify intent, then route to tool or Claude.
  const handleSmartSend = useCallback(async () => {
    const text = conversation.inputText.trim();
    const attachments = conversation.inputAttachments;
    const fileIds = attachments.map((file) => file.id);
    if ((!text && attachments.length === 0) || submitting) return;

    // Immediately clear input and show busy state — prevents double-clicks
    setSubmitting(true);
    conversation.setInputText("");
    conversation.setInputAttachments([]);

    // Optimistically append the user message so it appears instantly
    const optimisticMsg = {
      id: Date.now(),
      task_id: workItem.id,
      role: "user" as const,
      content: text,
      message_type: "text",
      created_by_name: null,
      created_by_color: null,
      created_at: new Date().toISOString(),
      attachments,
    };
    conversation.setMessages((prev: any[]) => [...prev, optimisticMsg]);
    conversation.markOptimisticPending();

    try {
      // If user pinned a tool, use it directly (no classification)
      if (text && pinnedToolId && toolStates) {
        const toolState = toolStates.get(pinnedToolId);
        if (toolState) {
          setPinnedToolId(null);
          await sendConversationMessage(appId, workItem.primary_conversation_id!, text, "user", undefined, fileIds);
          await toolState.execute(text);
          await conversation.reloadMessages();
          return;
        }
      }

      // Otherwise, classify intent
      if (text && toolStates) {
        try {
          const intent = await classifyIntent(appId, text);
          const toolState = toolStates.get(intent);

          if (toolState) {
            await sendConversationMessage(appId, workItem.primary_conversation_id!, text, "user", undefined, fileIds);
            await toolState.execute(text);
            await conversation.reloadMessages();
            return;
          }
        } catch {
          // Classification failed — fall through to Claude
        }
      }

      // Fall through to Claude — use consumeStream directly
      await conversation.consumeStream(text, false, fileIds);
    } catch (err) {
      conversation.setInputText(text);
      conversation.setInputAttachments(attachments);
      await conversation.reloadMessages().catch(() => {});
      console.error("Failed to send message:", err);
    } finally {
      setSubmitting(false);
    }
  }, [appId, workItem.id, conversation, toolStates, pinnedToolId, submitting]);

  const isArchived = workItem.status === "done" && !workItem.worktree_dir;

  return (
    <div className="flex flex-col h-full bg-transparent">
      <ConversationHeader
        workItem={workItem}
        isClaudeActive={conversation.isClaudeActive}
        autoScroll={autoScroll}
        setAutoScroll={setAutoScroll}
        activeClaudeStatus={conversation.activeClaudeStatus}
        archiving={archiving}
        handleArchive={handleArchive}
        handleRename={handleRename}
        isArchived={isArchived}
        branchControls={{
          pushBranch,
          createPR,
          updatePR,
          pushing,
          creatingPR,
          updatingPR,
          prResult,
          worktreeGitStatus,
          prUrl,
          branchError,
        }}
      />

      <ConversationMessages
        messages={conversation.messages}
        streamContent={conversation.streamContent}
        isClaudeActive={conversation.isClaudeActive}
        activeClaudeStatus={conversation.activeClaudeStatus}
        sending={conversation.sending}
        description={workItem.description}
        title={workItem.title}
        worktreeStatus={workItem.worktree_status}
        handleRetry={conversation.handleRetry}
        lastError={conversation.lastError}
        logEndRef={logEndRef}
        appId={appId}
        workItemId={workItem.id}
        toolStates={toolStates}
        setupNextSteps={{
          show: workItem.kind === "setup" && workItem.claude_status === "completed",
          appId,
          workItemId: workItem.id,
          branchName: workItem.branch_name,
          prResult: prResult,
          pushing,
          creatingPR,
          publishing,
          onPublish: publish,
          onPull: handlePull,
          pulling,
          branchError,
          prUrl,
          onMarkDone: handleMarkDone,
          markedDone,
        }}
      />

      {/* Hide input for archived conversations — read-only */}
      {!isArchived && (
        <ConversationInput
          appId={appId}
          toolActivities={conversation.toolActivities}
          worktreeReady={worktreeReady}
          inputText={conversation.inputText}
          setInputText={conversation.setInputText}
          inputAttachments={conversation.inputAttachments}
          setInputAttachments={conversation.setInputAttachments}
          handleSendMessage={handleSmartSend}
          sending={conversation.sending || submitting}
          isClaudeActive={conversation.isClaudeActive}
          handleStopClaude={conversation.handleStopClaude}
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          handleModelChange={handleModelChange}
          availableModels={modelConfig?.availableModels}
          toolStates={toolStates}
          pinnedToolId={pinnedToolId}
          onPinTool={setPinnedToolId}
          branchName={workItem.branch_name}
          isWorktree={!!workItem.worktree_dir}
        />
      )}
    </div>
  );
}
