"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AppFile, Task, ConversationMessage } from "@/lib/types";
import {
  getWorkItem,
  getConversationMessages,
  getConversationClaudeStatus,
  stopConversationClaude,
  streamConversationMessage,
} from "@/lib/api";
import {
  applyActivityToFeed,
  shouldReloadPreviewForActivity,
  type StreamActivityChip,
  type StreamActivityEvent,
} from "@/lib/toolSummary";

export type ToolActivity = StreamActivityChip;

interface UseConversationParams {
  appId: number;
  workItem: Task;
  setWorkItem: (workItem: Task) => void;
  onItemUpdate: () => void;
  selectedModel: string;
  selectedProvider: string;
}

export function useConversation({
  appId,
  workItem,
  setWorkItem,
  onItemUpdate,
  selectedModel,
  selectedProvider,
}: UseConversationParams) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [streamContent, setStreamContent] = useState("");
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [claudeStatus, setClaudeStatus] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState("");
  const [inputAttachments, setInputAttachments] = useState<AppFile[]>([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);

  const autoSentRef = useRef<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  // True while an optimistic message is pending (between append and loadMessages)
  const optimisticPendingRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const conversationId = workItem.primary_conversation_id!;
  const activeClaudeStatus = claudeStatus || workItem.claude_status;
  const isClaudeActive =
    activeClaudeStatus === "running" ||
    activeClaudeStatus === "waiting_approval";

  // Load messages
  const loadMessages = useCallback(async () => {
    try {
      const messages = await getConversationMessages(appId, conversationId);
      setMessages(messages);
      setMessagesLoaded(true);
      optimisticPendingRef.current = false;
    } catch {
      // Ignore errors
    }
  }, [appId, workItem.id]);

  // Initial load
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // ── SSE Event Channel ─────────────────────────────────────────────
  // Replaces the 3s multi-user polling and 2s status fallback
  const messagesRef = useRef<ConversationMessage[]>(messages);
  messagesRef.current = messages;

  useEffect(() => {
    const url = `/api/apps/${appId}/conversations/${conversationId}/events`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    // Clear any fallback polling when SSE connects
    const clearFallback = () => {
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
    };

    es.addEventListener("message", (e) => {
      if (optimisticPendingRef.current) return;
      try {
        const msg: ConversationMessage = JSON.parse(e.data);
        setMessages((prev) => {
          // Deduplicate by id
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      } catch {}
    });

    es.addEventListener("status", (e) => {
      try {
        const data = JSON.parse(e.data);
        // Don't override status while we're streaming locally
        if (streamAbortRef.current) return;
        setClaudeStatus(data.status);
        if (
          data.status === "completed" ||
          data.status === "failed" ||
          data.status === "stopped"
        ) {
          // Refresh work item on terminal status
          getWorkItem(appId, workItem.id).then((updated) => {
            setWorkItem(updated);
            onItemUpdate();
          }).catch(() => {});
          // Also reload messages to get final state
          loadMessages();
        }
      } catch {}
    });

    es.addEventListener("snapshot", (e) => {
      // Full message list on reconnect after server restart
      try {
        const data = JSON.parse(e.data);
        if (data.messages && !optimisticPendingRef.current) {
          setMessages(data.messages);
        }
      } catch {}
    });

    es.addEventListener("open", () => {
      clearFallback();
    });

    es.addEventListener("error", () => {
      // EventSource auto-reconnects, but start fallback polling as safety net
      if (!fallbackIntervalRef.current) {
        fallbackIntervalRef.current = setInterval(async () => {
          if (streamAbortRef.current || optimisticPendingRef.current) return;
          try {
            const [msgs, status] = await Promise.all([
              getConversationMessages(appId, conversationId),
              getConversationClaudeStatus(appId, conversationId),
            ]);
            const current = messagesRef.current;
            if (
              msgs.length !== current.length ||
              msgs[msgs.length - 1]?.id !== current[current.length - 1]?.id
            ) {
              setMessages(msgs);
            }
            if (status.claude_status !== claudeStatus && !streamAbortRef.current) {
              setClaudeStatus(status.claude_status);
            }
          } catch {}
        }, 10000);
      }
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
      clearFallback();
    };
  }, [appId, workItem.id, conversationId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
    };
  }, []);

  // Refresh preview iframe (no server restart needed)
  const reloadPreview = useCallback(() => {
    try {
      const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Preview"]');
      if (iframe) {
        iframe.contentWindow?.location.reload();
      }
    } catch {
      // Cross-origin or no iframe — non-critical
    }
  }, []);

  // Debounced preview reload for activity events (avoids rapid reloads during bursts of file writes)
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedReloadPreview = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadPreview();
      reloadTimerRef.current = null;
    }, 1500);
  }, [reloadPreview]);

  // Consume SSE stream (for active run — text/activity/status events)
  const consumeStream = useCallback(
    async (content: string, retry?: boolean, fileIds: number[] = []) => {
      try {
        const response = await streamConversationMessage(
          appId,
          conversationId,
          content,
          selectedModel,
          retry,
          selectedProvider,
          fileIds
        );
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const abort = new AbortController();
        streamAbortRef.current = abort;

        setClaudeStatus("running");
        setLastError(null);

        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";
        let hadCodeChanges = false;

        while (true) {
          if (abort.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const event of events) {
            if (!event.trim()) continue;
            let eventType = "";
            let dataStr = "";
            for (const line of event.split("\n")) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                dataStr += line.slice(6);
              }
            }
            if (!dataStr) continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (eventType === "text" && parsed.text) {
                accumulated += parsed.text;
                setStreamContent(accumulated);
              } else if (eventType === "activity" && parsed.kind) {
                const activity = parsed as StreamActivityEvent;
                setToolActivities((prev) => applyActivityToFeed(prev, activity));
                if (shouldReloadPreviewForActivity(activity)) {
                  hadCodeChanges = true;
                  debouncedReloadPreview();
                }
              } else if (
                eventType === "status" &&
                (parsed.status === "completed" || parsed.status === "failed" || parsed.status === "stopped")
              ) {
                setStreamContent("");
                setToolActivities([]);
                const updated = await getWorkItem(appId, workItem.id);
                setWorkItem(updated);
                setClaudeStatus(parsed.status);
                await loadMessages();
                onItemUpdate();
                if (parsed.status === "completed" && hadCodeChanges) reloadPreview();
              } else if (eventType === "done") {
                setStreamContent("");
                setToolActivities([]);
                const updated = await getWorkItem(appId, workItem.id);
                setWorkItem(updated);
                const status = await getConversationClaudeStatus(appId, conversationId);
                setClaudeStatus(status.claude_status);
                await loadMessages();
                onItemUpdate();
                if (hadCodeChanges) reloadPreview();
              } else if (eventType === "error") {
                setStreamContent("");
                setToolActivities([]);
                setClaudeStatus("failed");
                setLastError(parsed.detail || parsed.error || "An unexpected error occurred");
                const updated = await getWorkItem(appId, workItem.id);
                setWorkItem(updated);
                await loadMessages();
                onItemUpdate();
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }

        streamAbortRef.current = null;
      } catch (err: unknown) {
        streamAbortRef.current = null;
        throw err;
      }
    },
    [appId, workItem.id, selectedModel, selectedProvider, onItemUpdate, setWorkItem, loadMessages, reloadPreview, debouncedReloadPreview]
  );

  // Auto-send a server-seeded user message when it has not received an assistant response yet.
  const latestUserIndex = messages.reduce((latest, message, index) => (
    message.role === "user" ? index : latest
  ), -1);
  const latestUserMessage = latestUserIndex >= 0 ? messages[latestUserIndex] : null;
  const hasAssistantAfterLatestUser = latestUserIndex >= 0
    ? messages.slice(latestUserIndex + 1).some((message) => message.role === "assistant")
    : false;
  useEffect(() => {
    if (!messagesLoaded) return;
    if (optimisticPendingRef.current) return;
    if (hasAssistantAfterLatestUser) return;
    if (activeClaudeStatus === "running" || activeClaudeStatus === "waiting_approval") return;
    if (activeClaudeStatus === "failed" || activeClaudeStatus === "stopped") return;
    if (sending) return;
    if (workItem.origin_type === "room_plan") return;
    // Wait for worktree to be ready before sending
    if (workItem.worktree_status === "preparing") return;

    // If a user message already exists (e.g. saved during import), use it as the trigger
    // with retry=true to skip saving a duplicate. Otherwise use the work item description.
    const content = latestUserMessage
      ? latestUserMessage.content || "Please use the attached files as context."
      : workItem.description;
    if (!content) return;

    const autoSendKey = latestUserMessage
      ? `message:${latestUserMessage.id}`
      : `description:${workItem.id}`;
    if (autoSentRef.current === autoSendKey) return;
    autoSentRef.current = autoSendKey;

    (async () => {
      setSending(true);
      setStreamContent("");
      try {
        // retry=true to skip saving duplicate user message (already saved by POST handler or import)
        await consumeStream(content, true);
      } catch {
        // Stream failed — messages should still be loaded from DB
        await loadMessages();
      } finally {
        setSending(false);
        setStreamContent("");
      }
    })();
  }, [
    messagesLoaded,
    latestUserMessage,
    hasAssistantAfterLatestUser,
    activeClaudeStatus,
    workItem.description,
    workItem.origin_type,
    workItem.worktree_status,
    workItem.id,
    sending,
    consumeStream,
    loadMessages,
  ]);

  // Send a message to Claude
  const handleSendMessage = useCallback(async () => {
    if ((!inputText.trim() && inputAttachments.length === 0) || sending) return;
    const content = inputText.trim();
    const attachments = inputAttachments;
    setSending(true);
    setInputText("");
    setInputAttachments([]);
    setStreamContent("");

    // Optimistically append the user message so it appears instantly
    const optimisticMsg: ConversationMessage = {
      id: Date.now(), // temporary ID — will be replaced on next loadMessages
      conversation_id: conversationId,
      role: "user",
      content,
      message_type: "text",
      created_by_name: null,
      created_by_color: null,
      created_at: new Date().toISOString(),
      attachments,
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      await consumeStream(content, false, attachments.map((file) => file.id));
    } catch {
      // Stream failed — try to load messages from DB
      setInputText(content);
      setInputAttachments(attachments);
      await loadMessages();
      const updated = await getWorkItem(appId, workItem.id);
      setWorkItem(updated);
    } finally {
      setSending(false);
      setStreamContent("");
    }
  }, [inputText, inputAttachments, sending, consumeStream, loadMessages, appId, workItem.id, setWorkItem]);

  // Stop Claude
  const handleStopClaude = useCallback(async () => {
    try {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
      await stopConversationClaude(appId, conversationId);
      setStreamContent("");
      const updated = await getWorkItem(appId, workItem.id);
      setWorkItem(updated);
      setClaudeStatus(updated.claude_status);
      await loadMessages();
      onItemUpdate();
    } catch (err) {
      console.error("Failed to stop Claude:", err);
    }
  }, [appId, workItem.id, setWorkItem, onItemUpdate, loadMessages]);

  // Retry: resend last user message (with retry flag to skip duplicate save)
  const handleRetry = useCallback(async () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    setSending(true);
    setStreamContent("");
    try {
      await consumeStream(lastUserMsg.content, true);
    } catch {
      await loadMessages();
    } finally {
      setSending(false);
      setStreamContent("");
    }
  }, [messages, consumeStream, loadMessages]);

  return {
    messages,
    setMessages,
    streamContent,
    toolActivities,
    claudeStatus: activeClaudeStatus,
    activeClaudeStatus,
    isClaudeActive,
    sending,
    lastError,
    inputText,
    setInputText,
    inputAttachments,
    setInputAttachments,
    handleSendMessage,
    handleStopClaude,
    handleRetry,
    reloadMessages: loadMessages,
    consumeStream,
    markOptimisticPending: () => { optimisticPendingRef.current = true; },
  };
}
