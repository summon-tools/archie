"use client";

import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import useSWR, { useSWRConfig } from "swr";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatsCircle, CheckCircle, DotsThree, Flag, PauseCircle, Pencil, PencilSimple, PlayCircle, Sparkle, Timer } from "@phosphor-icons/react";
import { executeNextPlanStep, generateRoomPlan, pausePlanExecution, resumePlanExecution, runPlanStepGates, streamRoomMessage, updatePlanStep, updateRoomPlan } from "@/lib/api";
import { fetcher } from "@/lib/swr";
import type { AppFile, HomeAgentConfig, HomeRoom, PlanStep, RoomMessage, RoomPlanResponse, Task } from "@/lib/types";
import { DEFAULT_HOME_AGENTS, type HomeAgentDefinition } from "@/lib/home/agents";
import { PROSE_CLASSES } from "@/lib/prose";
import { MessageAttachmentList } from "@/components/Attachments";
import RoomChatInput from "@/components/RoomChatInput";
import ToolActivity from "@/components/ToolActivity";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import {
  applyActivityToFeed,
  type StreamActivityChip,
  type StreamActivityEvent,
} from "@/lib/toolSummary";

function parseDbTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function planElapsedMs(plan: NonNullable<RoomPlanResponse["plan"]>, now: number): number {
  const startedAt = parseDbTimestampMs(plan.execution_started_at);
  if (!startedAt) return 0;

  const accumulatedPausedMs = Math.max(0, plan.execution_paused_ms || 0);
  const currentPausedMs = plan.execution_state === "paused"
    ? Math.max(0, now - (parseDbTimestampMs(plan.execution_paused_at) || now))
    : 0;

  return Math.max(0, now - startedAt - accumulatedPausedMs - currentPausedMs);
}

interface RoomWorkspaceProps {
  appId: number;
  room: HomeRoom | null;
  onOpenConversation: (itemId: number) => void;
  onWorkItemCreated: (item: Task) => void;
  onCloseRoom: (roomId: number) => void;
  onRenameRoom: (roomId: number, title: string) => Promise<void>;
}

export default function RoomWorkspace({ appId, room, onOpenConversation, onWorkItemCreated, onCloseRoom, onRenameRoom }: RoomWorkspaceProps) {
  const { mutate: mutateGlobal } = useSWRConfig();
  const { leftWidth, isDragging, containerRef, dragHandleProps } = useResizablePanel({
    storageKey: "archie-room-plan-ratio",
    defaultWidth: 78,
    minWidth: 58,
    maxWidth: 84,
  });
  const [messageDraft, setMessageDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AppFile[]>([]);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<RoomMessage[]>([]);
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const [streamContent, setStreamContent] = useState("");
  const [toolActivities, setToolActivities] = useState<StreamActivityChip[]>([]);
  const [thinkingAgentKey, setThinkingAgentKey] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: messagesData, mutate: mutateMessages } = useSWR<{ messages: RoomMessage[] }>(
    room ? `/api/apps/${appId}/rooms/${room.id}/messages` : null,
    fetcher,
  );
  const { data: agentsData } = useSWR<{ agents: HomeAgentConfig[] }>(
    room ? "/api/settings/agents" : null,
    fetcher,
  );
  const agents = (agentsData?.agents || DEFAULT_HOME_AGENTS) as HomeAgentDefinition[];
  const messages = messagesData?.messages || [];
  const visibleMessages = useMemo(() => {
    const chatMessages = messages.filter((message) => !isExecutionLogMessage(message));
    const persistedBodies = new Set(chatMessages.map((message) => `${message.role}:${message.body_md}`));
    const pending = pendingMessages.filter((message) => (
      message.room_id === room?.id && !persistedBodies.has(`${message.role}:${message.body_md}`)
    ));
    return [...chatMessages, ...pending];
  }, [messages, pendingMessages, room?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [visibleMessages.length, streamContent, toolActivities.length, sendingMessage]);

  const handleSendRoomMessage = async () => {
    if (!room || (!messageDraft.trim() && pendingAttachments.length === 0) || sendingMessage) return;
    const content = messageDraft.trim();
    const attachments = pendingAttachments;
    const targetAgentKey = selectedAgentKey;
    const optimisticMessage: RoomMessage = {
      id: -Date.now(),
      room_id: room.id,
      author_user_id: null,
      agent_key: null,
      role: "user",
      kind: "message",
      body_md: content,
      payload_json: targetAgentKey ? JSON.stringify({ target_agent_key: targetAgentKey }) : null,
      created_at: new Date().toISOString(),
      attachments,
    };
    setSendingMessage(true);
    setMessageError(null);
    setMessageDraft("");
    setPendingAttachments([]);
    setStreamContent("");
    setToolActivities([]);
    setThinkingAgentKey(targetAgentKey || "coordinator");
    setPendingMessages((prev) => [...prev, optimisticMessage]);
    try {
      const response = await streamRoomMessage(appId, room.id, content, targetAgentKey, attachments.map((file) => file.id));
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let shouldRefreshPlan = false;

      while (true) {
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

          const parsed = JSON.parse(dataStr);
          if (eventType === "text" && parsed.text) {
            accumulated += parsed.text;
            setStreamContent(accumulated);
          } else if (eventType === "activity" && parsed.kind) {
            setToolActivities((prev) => applyActivityToFeed(prev, parsed as StreamActivityEvent));
          } else if (eventType === "plan_updated") {
            shouldRefreshPlan = true;
            void mutateGlobal(`/api/apps/${appId}/rooms/${room.id}/plan`);
          } else if (eventType === "error") {
            setMessageError(parsed.detail || parsed.error || "Room agent failed");
          }
        }
      }

      await mutateMessages();
      if (shouldRefreshPlan) {
        await mutateGlobal(`/api/apps/${appId}/rooms/${room.id}/plan`);
      }
      setSelectedAgentKey(null);
    } catch (err) {
      setMessageDraft(content);
      setPendingAttachments(attachments);
      setMessageError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setPendingMessages((prev) => prev.filter((pending) => pending.id !== optimisticMessage.id));
      setSendingMessage(false);
      setThinkingAgentKey(null);
      setStreamContent("");
      setToolActivities([]);
    }
  };

  return (
    <div className="flex-1 min-h-0 bg-th-main flex" ref={containerRef}>
      <main
        className="h-full min-w-0 flex flex-col"
        style={{ width: `${leftWidth}%` }}
      >
        {room ? (
          <RoomShell
            room={room}
            messages={visibleMessages}
            draft={messageDraft}
            setDraft={setMessageDraft}
            attachments={pendingAttachments}
            setAttachments={setPendingAttachments}
            sending={sendingMessage}
            error={messageError}
            streamContent={streamContent}
            toolActivities={toolActivities}
            selectedAgentKey={selectedAgentKey}
            setSelectedAgentKey={setSelectedAgentKey}
            thinkingAgentKey={thinkingAgentKey}
            agents={agents}
            onSend={handleSendRoomMessage}
            onCloseRoom={() => onCloseRoom(room.id)}
            onRenameRoom={(title) => onRenameRoom(room.id, title)}
            chatEndRef={chatEndRef}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-sm text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-th-muted flex items-center justify-center">
                <Sparkle size={22} className="text-th-muted" />
              </div>
              <h2 className="text-lg font-semibold text-th-primary">Create a room to start planning</h2>
              <p className="mt-2 text-sm text-th-muted">
                Rooms are for discussion, planning, and coordinated execution. They do not create worktrees until a plan step becomes a task.
              </p>
            </div>
          </div>
        )}
      </main>

      <div
        className={`w-1 flex-shrink-0 relative group transition-colors ${
          isDragging
            ? "bg-brand-400/40"
            : "bg-th-subtle hover:bg-brand-400/30"
        }`}
        {...dragHandleProps}
      >
        <div
          className={`absolute inset-y-0 -left-0.5 -right-0.5 ${
            isDragging ? "" : "group-hover:bg-brand-400/10"
          }`}
        />
      </div>

      <aside
        className="h-full min-w-0 bg-th-panel flex flex-col"
        style={{
          width: `${100 - leftWidth}%`,
          pointerEvents: isDragging ? "none" : undefined,
        }}
      >
        <PlanPanel
          appId={appId}
          room={room}
          messages={messages}
          onOpenConversation={onOpenConversation}
          onWorkItemCreated={onWorkItemCreated}
        />
      </aside>
    </div>
  );
}

function RoomShell({
  room,
  messages,
  draft,
  setDraft,
  attachments,
  setAttachments,
  sending,
  error,
  streamContent,
  toolActivities,
  selectedAgentKey,
  setSelectedAgentKey,
  thinkingAgentKey,
  agents,
  onSend,
  onCloseRoom,
  onRenameRoom,
  chatEndRef,
}: {
  room: HomeRoom;
  messages: RoomMessage[];
  draft: string;
  setDraft: (value: string) => void;
  attachments: AppFile[];
  setAttachments: (files: AppFile[]) => void;
  sending: boolean;
  error: string | null;
  streamContent: string;
  toolActivities: StreamActivityChip[];
  selectedAgentKey: string | null;
  setSelectedAgentKey: (agentKey: string | null) => void;
  thinkingAgentKey: string | null;
  agents: HomeAgentDefinition[];
  onSend: () => void;
  onCloseRoom: () => void;
  onRenameRoom: (title: string) => Promise<void>;
  chatEndRef: RefObject<HTMLDivElement | null>;
}) {
  const statusAgentName = getAgentName(thinkingAgentKey || selectedAgentKey, agents);
  const isClosed = room.status !== "open";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="h-10 px-6 border-b border-th flex items-center justify-between gap-3">
        <RoomTitleDropdown title={room.title} onRename={onRenameRoom} />
        {!isClosed && <CloseRoomButton onCloseRoom={onCloseRoom} />}
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-th-muted flex items-center justify-center">
                <ChatsCircle size={22} className="text-th-muted" />
              </div>
              <h3 className="text-base font-semibold text-th-primary">Start the room discussion</h3>
              <p className="mt-2 text-sm text-th-muted">
                Ask questions, explore risks, and shape the plan before launching implementation tasks.
              </p>
            </div>
          ) : (
            <div className="space-y-4" aria-live="polite">
              {messages.map((message) => (
                <RoomMessageBubble key={message.id} message={message} agents={agents} />
              ))}
            </div>
          )}

          {(streamContent || sending || toolActivities.length > 0) && (
            <RoomStreamingBubble
              content={streamContent}
              agentName={statusAgentName}
              toolActivities={toolActivities}
            />
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      <div>
        {error && (
          <div className="max-w-3xl mx-auto px-6 pt-3">
            <p className="text-sm text-st-red">{error}</p>
          </div>
        )}
        {isClosed ? (
          <div className="max-w-3xl mx-auto px-6 pb-5 pt-2">
            <div className="rounded-lg border border-th bg-th-panel px-3 py-2 text-sm text-th-muted">
              This room is closed.
            </div>
          </div>
        ) : (
          <RoomChatInput
            value={draft}
            onChange={setDraft}
            onSubmit={onSend}
            appId={room.app_id}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            agents={agents}
            selectedAgentKey={selectedAgentKey}
            onSelectAgent={setSelectedAgentKey}
            disabled={sending}
            isLoading={sending}
            statusText={sending ? `${statusAgentName} is thinking...` : undefined}
          />
        )}
      </div>
    </div>
  );
}

function RoomTitleDropdown({
  title,
  onRename,
}: {
  title: string;
  onRename: (newTitle: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setRenaming(false);
        setError(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!renaming) setRenameValue(title);
  }, [renaming, title]);

  const handleRenameSubmit = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    if (trimmed === title) {
      setRenaming(false);
      setOpen(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onRename(trimmed);
      setRenaming(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename room");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex min-w-0 items-center gap-1" ref={ref}>
      <button
        onClick={() => {
          setOpen((value) => !value);
          setError(null);
        }}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex min-w-0 items-center gap-1 group"
      >
        <span className="min-w-0 max-w-[220px] truncate text-sm font-semibold text-th-primary" title={title}>
          {title}
        </span>
        <DotsThree size={16} weight="bold" className="flex-shrink-0 text-th-muted" />
      </button>

      {open && !renaming && (
        <div className="absolute left-0 top-full mt-1 w-48 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50">
          <button
            onClick={() => {
              setRenaming(true);
              setRenameValue(title);
              setError(null);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-th-muted transition-colors text-left"
          >
            <Pencil size={15} weight="bold" className="text-th-muted flex-shrink-0" />
            <span className="text-th-primary text-xs">Rename</span>
          </button>
        </div>
      )}

      {open && renaming && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50 p-2">
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleRenameSubmit();
              if (event.key === "Escape") {
                setRenaming(false);
                setOpen(false);
              }
            }}
            className="w-full px-2.5 py-1.5 bg-th-subtle border border-th rounded-lg text-sm text-th-primary focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent"
          />
          {error && <p className="mt-2 text-xs text-st-red">{error}</p>}
          <div className="flex justify-end gap-1.5 mt-2">
            <button
              onClick={() => {
                setRenaming(false);
                setOpen(false);
              }}
              disabled={saving}
              className="px-2.5 py-1 text-xs text-th-muted hover:text-th-primary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleRenameSubmit()}
              disabled={saving || !renameValue.trim()}
              className="px-2.5 py-1 text-xs font-medium bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CloseRoomButton({ onCloseRoom }: { onCloseRoom: () => void }) {
  const [confirmingClose, setConfirmingClose] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmingClose) return;
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setConfirmingClose(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [confirmingClose]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setConfirmingClose(true)}
        className="rounded-lg px-2.5 py-1 text-xs font-medium text-th-secondary hover:text-th-primary hover:bg-th-muted transition-colors"
        title="Close room"
        aria-label="Close room"
        aria-expanded={confirmingClose}
      >
        Close room
      </button>

      {confirmingClose && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50 p-3">
          <p className="text-xs text-th-muted mb-2.5">Close this room?</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => setConfirmingClose(false)}
              className="flex-1 px-2.5 py-1 text-xs text-th-muted hover:text-th-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onCloseRoom();
                setConfirmingClose(false);
              }}
              className="flex-1 px-2.5 py-1 text-xs font-medium bg-st-red text-st-red-strong border border-st-red rounded-lg hover:bg-st-red-hover transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RoomStreamingBubble({
  content,
  agentName,
  toolActivities,
}: {
  content: string;
  agentName: string;
  toolActivities: StreamActivityChip[];
}) {
  return (
    <div className="flex justify-start animate-fadeIn" aria-live="polite">
      <div className="max-w-[78%] rounded-xl border border-th bg-th-panel px-3 py-2 text-th-primary">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-meta font-semibold text-th-dimmed">{agentName}</span>
          <span className="text-meta text-th-dimmed">thinking</span>
        </div>
        {toolActivities.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {toolActivities.map((activity, index) => (
              <ToolActivity
                key={`${activity.id}-${index}`}
                kind={activity.kind}
                tool={activity.tool}
                summary={activity.summary}
                active={activity.active}
              />
            ))}
          </div>
        )}
        {content ? (
          <div className={PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-th-muted">Working...</p>
        )}
      </div>
    </div>
  );
}

const RoomMessageBubble = memo(function RoomMessageBubble({ message, agents }: { message: RoomMessage; agents: HomeAgentDefinition[] }) {
  const isUser = message.role === "user";
  const label = isUser ? "You" : message.agent_key ? formatAgentLabel(message.agent_key) : "Archie";
  const taggedAgent = isUser ? getTaggedAgentName(message, agents) : null;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-xl px-3 py-2 ${
        isUser ? "bg-th-muted text-th-primary rounded-2xl rounded-tr-sm" : "bg-th-panel border border-th text-th-primary"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-meta font-semibold ${isUser ? "text-th-dimmed" : "text-th-dimmed"}`}>
            {label}
          </span>
          {message.kind !== "message" && (
            <span className={`text-meta ${isUser ? "text-th-dimmed" : "text-th-dimmed"}`}>
              {message.kind.replace("_", " ")}
            </span>
          )}
          {taggedAgent && (
            <span className={`rounded-full px-1.5 py-0.5 text-meta font-medium ${
              isUser ? "bg-th-subtle text-th-secondary" : "bg-th-muted text-th-dimmed"
            }`}>
              @{taggedAgent}
            </span>
          )}
        </div>
        {isUser ? (
          message.body_md ? <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.body_md}</p> : null
        ) : (
          message.body_md ? (
            <div className={PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.body_md}</ReactMarkdown>
            </div>
          ) : null
        )}
        <MessageAttachmentList attachments={message.attachments} />
      </div>
    </div>
  );
});

function isExecutionLogMessage(message: RoomMessage): boolean {
  return message.role === "system" && (message.kind === "execution_event" || message.kind === "error");
}

function getTaggedAgentName(message: RoomMessage, agents: HomeAgentDefinition[]): string | null {
  if (!message.payload_json) return null;
  try {
    const payload = JSON.parse(message.payload_json) as { target_agent_key?: unknown };
    if (typeof payload.target_agent_key !== "string") return null;
    const agent = agents.find((candidate) => candidate.key === payload.target_agent_key);
    return agent?.name || null;
  } catch {
    return null;
  }
}

function getAgentName(agentKey: string | null, agents: HomeAgentDefinition[]): string {
  if (!agentKey) return "Coordinator";
  return agents.find((agent) => agent.key === agentKey)?.name || "Coordinator";
}

function formatAgentLabel(agentKey: string): string {
  return agentKey
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function PlanPanel({
  appId,
  room,
  messages,
  onOpenConversation,
  onWorkItemCreated,
}: {
  appId: number;
  room: HomeRoom | null;
  messages: RoomMessage[];
  onOpenConversation: (itemId: number) => void;
  onWorkItemCreated: (item: Task) => void;
}) {
  const { data, mutate, isLoading } = useSWR<RoomPlanResponse>(
    room ? `/api/apps/${appId}/rooms/${room.id}/plan` : null,
    fetcher,
    { refreshInterval: room ? 2000 : 0 },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoGateRunKey, setAutoGateRunKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"plan" | "context" | "execution">("plan");
  const [now, setNow] = useState(() => Date.now());

  const plan = data?.plan || null;
  const steps = data?.steps || [];
  const planningContext = data?.planning_context_md || room?.planning_context_md || "";
  const activeStep = steps.find((step) => ["implementing", "reviewing", "fixing", "validating", "committing"].includes(step.status));
  const nextPendingStep = steps.find((step) => step.status === "pending");
  const lastCompletedStep = [...steps].reverse().find((step) => step.status === "completed");
  const executionWorkItemId = activeStep?.linked_work_item_id || [...steps].reverse().find((step) => step.linked_work_item_id)?.linked_work_item_id || null;
  const roomClosed = room?.status !== "open";
  const executionPaused = plan?.execution_state === "paused";
  const executionRunning = plan?.status === "executing" && plan.execution_state !== "paused";
  const executionElapsedMs = plan ? planElapsedMs(plan, now) : 0;
  const executionLogEntries = useMemo(() => (
    buildExecutionLogEntries(messages, steps, plan?.execution_started_at || null)
  ), [messages, steps, plan?.execution_started_at]);

  useEffect(() => {
    setAutoGateRunKey(null);
    setActiveTab("plan");
  }, [room?.id]);

  const currentGate = activeStep?.events?.find((event) => (
    GATE_LABELS[event.phase] && (event.status === "pending" || event.status === "running")
  ));
  const runningGateStartedAt = currentGate?.status === "running" ? parseDbTimestampMs(currentGate.created_at) : null;

  useEffect(() => {
    if (!plan || (!executionRunning && !executionPaused && !runningGateStartedAt)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [executionPaused, executionRunning, plan, runningGateStartedAt]);

  useEffect(() => {
    if (!room || roomClosed || executionPaused || !activeStep || !currentGate) return;
    if (!["reviewing", "validating", "committing"].includes(activeStep.status)) return;

    const key = `${room.id}:${activeStep.id}:${currentGate.id}:${currentGate.status}`;
    if (autoGateRunKey === key) return;
    setAutoGateRunKey(key);

    void runPlanStepGates(appId, room.id, activeStep.id)
      .then(() => mutate())
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to run automated gate");
      });
  }, [activeStep, appId, autoGateRunKey, currentGate, executionPaused, mutate, room, roomClosed]);

  useEffect(() => {
    if (!room || roomClosed || executionPaused || !plan || activeStep || !nextPendingStep || !lastCompletedStep) return;
    if (plan.status !== "executing") return;

    const key = `${room.id}:continue:${lastCompletedStep.id}:${nextPendingStep.id}`;
    if (autoGateRunKey === key) return;
    setAutoGateRunKey(key);

    void runPlanStepGates(appId, room.id, lastCompletedStep.id)
      .then(() => mutate())
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to continue plan execution");
      });
  }, [activeStep, appId, autoGateRunKey, executionPaused, lastCompletedStep, mutate, nextPendingStep, plan, room, roomClosed]);

  const handleGeneratePlan = async () => {
    if (!room || roomClosed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await generateRoomPlan(appId, room.id);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate plan");
    } finally {
      setBusy(false);
    }
  };

  const handleExecuteNext = async () => {
    if (!room || !plan || roomClosed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await executeNextPlanStep(appId, room.id);
      await mutate();
      onWorkItemCreated(result.work_item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute next step");
    } finally {
      setBusy(false);
    }
  };

  const handlePauseExecution = async () => {
    if (!room || !plan || roomClosed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await pausePlanExecution(appId, room.id);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause execution");
    } finally {
      setBusy(false);
    }
  };

  const handleResumeExecution = async () => {
    if (!room || !plan || roomClosed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resumePlanExecution(appId, room.id);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume execution");
    } finally {
      setBusy(false);
    }
  };

  const handleMarkReady = async () => {
    if (!room || !plan || roomClosed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateRoomPlan(appId, room.id, { status: "ready" });
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update plan");
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateStep = async (step: PlanStep, fields: PlanStepEditableFields): Promise<boolean> => {
    if (!room || roomClosed || busy) return false;
    setBusy(true);
    setError(null);
    try {
      await updatePlanStep(appId, room.id, step.id, fields);
      await mutate();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update plan step");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col min-h-0 h-full">
      <header className="h-10 px-2 border-b border-th flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center bg-th-muted rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("plan")}
            className={planPanelTabClass(activeTab === "plan")}
          >
            Plan
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("context")}
            className={planPanelTabClass(activeTab === "context")}
          >
            Planning Context
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("execution")}
            className={planPanelTabClass(activeTab === "execution")}
          >
            Execution Log
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {error && <p className="text-sm text-st-red">{error}</p>}

        {!room ? (
          <p className="text-sm text-th-muted">Select a room to draft a structured plan.</p>
        ) : activeTab === "execution" ? (
          <ExecutionLogPanel entries={executionLogEntries} />
        ) : activeTab === "context" ? (
          <PlanningContextPanel
            planningContext={planningContext}
            updated={Boolean(data?.planning_context_updated_at)}
          />
        ) : (
          <>
            {isLoading ? (
              <p className="text-sm text-th-muted">Loading plan...</p>
            ) : !plan ? (
              <div className="rounded-lg border border-dashed border-th p-4">
                <Flag size={18} className="text-th-muted mb-2" />
                <p className="text-sm font-medium text-th-secondary">Create a structured plan</p>
                <p className="mt-1 text-xs text-th-muted">
                  The plan will hold executable steps, gates, task links, and progress.
                </p>
                <button
                  onClick={handleGeneratePlan}
                  disabled={busy || roomClosed}
                  className="mt-3 w-full rounded-lg bg-btn-primary text-btn-primary px-3 py-2 text-sm font-medium disabled:opacity-60"
                >
                  {busy ? "Generating..." : "Generate draft plan"}
                </button>
              </div>
            ) : (
              <>
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-th-primary flex-1 min-w-0 truncate">
                      {plan.title}
                    </h3>
                    <span className={`text-meta font-medium rounded-full px-2 py-1 ${statusBadgeClass(executionPaused ? "paused" : plan.status)}`}>
                      {executionPaused ? "paused" : plan.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-th bg-th-main px-3 py-2">
                    <Timer size={15} className="text-th-dimmed flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-th-secondary">
                        {plan.execution_state === "paused"
                          ? `Paused after ${formatDuration(executionElapsedMs)}`
                          : plan.execution_state === "running"
                            ? `Running for ${formatDuration(executionElapsedMs)}`
                            : plan.execution_state === "completed"
                              ? `Completed in ${formatDuration(executionElapsedMs || plan.execution_elapsed_ms || 0)}`
                              : "Not started"}
                      </p>
                      {runningGateStartedAt && (
                        <p className="text-meta text-th-dimmed">
                          {GATE_LABELS[currentGate!.phase]} running for {formatDuration(now - runningGateStartedAt)}
                        </p>
                      )}
                    </div>
                    {plan.status === "executing" && (
                      executionPaused ? (
                        <button
                          onClick={handleResumeExecution}
                          disabled={busy || roomClosed}
                          className="inline-flex items-center gap-1 rounded-md border border-th px-2 py-1 text-xs font-medium text-th-secondary hover:text-th-primary hover:bg-th-subtle disabled:opacity-50"
                        >
                          <PlayCircle size={14} />
                          Resume
                        </button>
                      ) : (
                        <button
                          onClick={handlePauseExecution}
                          disabled={busy || roomClosed}
                          className="inline-flex items-center gap-1 rounded-md border border-th px-2 py-1 text-xs font-medium text-th-secondary hover:text-th-primary hover:bg-th-subtle disabled:opacity-50"
                        >
                          <PauseCircle size={14} />
                          Pause
                        </button>
                      )
                    )}
                  </div>
                  {executionWorkItemId && (activeStep || plan.status === "completed") ? (
                    <button
                      onClick={() => onOpenConversation(executionWorkItemId)}
                      className="w-full rounded-lg border border-th px-3 py-2 text-sm font-medium text-th-secondary hover:text-th-primary hover:bg-th-subtle"
                    >
                      {plan.status === "completed" ? "Open task for approval" : "Open active task"}
                    </button>
                  ) : plan.status === "draft" && steps.length > 0 ? (
                    <button
                      onClick={handleMarkReady}
                      disabled={busy || roomClosed}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-btn-primary text-btn-primary px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle size={16} />
                      {busy ? "Updating..." : "Mark ready"}
                    </button>
                  ) : (
                    <button
                      onClick={handleExecuteNext}
                      disabled={busy || roomClosed || executionPaused || !nextPendingStep || !["ready", "executing"].includes(plan.status)}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-btn-primary text-btn-primary px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <PlayCircle size={16} />
                      {busy ? "Starting..." : "Execute next step"}
                    </button>
                  )}
                </section>

                {plan.summary_md && (
                  <div className="rounded-lg border border-th bg-th-main p-3">
                    <p className="text-xs text-th-primary leading-relaxed whitespace-pre-wrap">{plan.summary_md}</p>
                  </div>
                )}

                <section>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-meta font-semibold text-th-primary uppercase tracking-wider">Steps</p>
                  </div>

                  {steps.length === 0 ? (
                    <p className="text-sm text-th-muted">No steps yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {steps.map((step) => (
                        <PlanStepCard
                          key={step.id}
                          step={step}
                          busy={busy}
                          onUpdateStep={handleUpdateStep}
                          editable={!roomClosed && (plan.status === "draft" || plan.status === "ready" || (plan.status === "executing" && executionPaused && step.status === "pending"))}
                        />
                      ))}
                    </div>
                  )}
                </section>

              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const GATE_LABELS: Record<string, string> = {
  architecture_review: "Architecture",
  code_review: "Review",
  security_review: "Security",
  qa_validation: "QA",
  commit: "Commit",
};

type ExecutionLogEntry = {
  id: string;
  body: string;
  kind: RoomMessage["kind"];
  agentLabel: string;
  createdAt: string;
  createdAtMs: number;
  durationSincePreviousMs: number;
};

type PlanStepEditableFields = {
  title?: string;
  objective_md?: string;
  risk_level?: PlanStep["risk_level"];
  requires_architecture_review?: boolean;
  requires_security_review?: boolean;
};

function planPanelTabClass(active: boolean): string {
  return [
    "flex min-w-0 flex-1 items-center justify-center gap-1 truncate rounded px-2 py-0.5 text-xs font-medium transition-colors",
    active
      ? "bg-th-elevated text-th-primary shadow-sm"
      : "text-th-muted hover:text-th-secondary",
  ].join(" ");
}

function PlanningContextPanel({ planningContext, updated }: { planningContext: string; updated: boolean }) {
  return (
    <section className="rounded-lg border border-th bg-th-main p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-meta font-semibold text-th-primary uppercase tracking-wider">Planning Context</p>
        {updated && <span className="text-meta text-th-dimmed">updated</span>}
      </div>
      {planningContext.trim() ? (
        <div className={PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{planningContext}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-xs text-th-muted leading-relaxed">
          The working planning context will appear here as the room discussion develops.
        </p>
      )}
    </section>
  );
}

const EXECUTION_AGENT_LABELS: Record<string, string> = {
  coordinator: "Coordinator",
  architect: "Architect",
  implementer: "Implementer",
  reviewer: "Reviewer",
  qa: "QA",
  security: "Security",
};

const PHASE_AGENT_LABELS: Record<string, string> = {
  implementation: "Implementer",
  architecture_review: "Architect",
  code_review: "Reviewer",
  security_review: "Security",
  qa_validation: "QA",
  commit: "Coordinator",
};

function formatExecutionAgentLabel(agentKey: string | null | undefined): string {
  if (!agentKey) return "Coordinator";
  return EXECUTION_AGENT_LABELS[agentKey] || formatAgentLabel(agentKey);
}

function parseMessagePayload(message: RoomMessage): Record<string, unknown> | null {
  if (!message.payload_json) return null;

  try {
    const parsed = JSON.parse(message.payload_json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function numericPayloadValue(payload: Record<string, unknown> | null, key: string): number | null {
  if (!payload) return null;
  const value = payload[key];
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function eventAgentLabel(event: NonNullable<PlanStep["events"]>[number]): string {
  if (event.phase === "implementation") return PHASE_AGENT_LABELS.implementation;
  if (event.agent_key) return formatExecutionAgentLabel(event.agent_key);
  return PHASE_AGENT_LABELS[event.phase] || "Coordinator";
}

function resolveExecutionLogAgent(message: RoomMessage, steps: PlanStep[]): string {
  const payload = parseMessagePayload(message);
  const gateEventId = numericPayloadValue(payload, "gate_event_id");
  if (gateEventId !== null) {
    for (const step of steps) {
      const event = step.events?.find((candidate) => candidate.id === gateEventId);
      if (event) return eventAgentLabel(event);
    }
  }

  const body = message.body_md.toLowerCase();
  if (body.includes("implementation") || body.includes("queued step")) return "Implementer";
  if (message.agent_key) return formatExecutionAgentLabel(message.agent_key);
  return "Coordinator";
}

function buildExecutionLogEntries(messages: RoomMessage[], steps: PlanStep[], executionStartedAt: string | null): ExecutionLogEntry[] {
  const entries = messages
    .filter(isExecutionLogMessage)
    .map((message) => ({
      id: `message:${message.id}`,
      body: message.body_md,
      kind: message.kind,
      agentLabel: resolveExecutionLogAgent(message, steps),
      createdAt: message.created_at,
      createdAtMs: parseDbTimestampMs(message.created_at) || 0,
      durationSincePreviousMs: 0,
    }))
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  let previousMs = parseDbTimestampMs(executionStartedAt) || entries[0]?.createdAtMs || null;
  return entries.map((entry) => {
    const durationSincePreviousMs = previousMs === null
      ? 0
      : Math.max(0, entry.createdAtMs - previousMs);
    previousMs = entry.createdAtMs;
    return { ...entry, durationSincePreviousMs };
  });
}

function formatLogTimestamp(value: string): string {
  const ms = parseDbTimestampMs(value);
  if (!ms) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ms));
}

function ExecutionLogPanel({ entries }: { entries: ExecutionLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-th bg-th-main p-4">
        <p className="text-sm text-th-muted">Execution events will appear here when the plan starts running.</p>
      </div>
    );
  }

  return (
    <section className="space-y-0">
      {entries.map((entry, index) => (
        <article
          key={entry.id}
          className="grid grid-cols-[4.75rem_1rem_minmax(0,1fr)] gap-2 pb-4 last:pb-0"
        >
          <div className="pt-1 text-right">
            <time className="block text-meta font-medium text-th-secondary">
              {formatLogTimestamp(entry.createdAt)}
            </time>
            <span className="mt-0.5 block text-meta text-th-dimmed">
              +{formatDuration(entry.durationSincePreviousMs)}
            </span>
          </div>

          <div className="relative flex justify-center">
            <span
              aria-hidden
              className={`absolute top-0 w-px bg-th-strong ${
                index === entries.length - 1 ? "bottom-[calc(100%-0.75rem)]" : "bottom-[-1rem]"
              }`}
            />
            <span
              aria-hidden
              className="relative mt-1.5 h-3 w-3 rounded-full border-2 border-[#555] bg-[#555]"
            />
          </div>

          <div className="min-w-0 pt-0.5">
            <span className="mb-1.5 inline-flex rounded-full bg-st-green px-2 py-0.5 text-meta font-medium text-st-green">
              {entry.agentLabel}
            </span>
            <div className={COMPACT_PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body}</ReactMarkdown>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function statusTextClass(status: string): string {
  switch (status) {
    case "completed":
    case "passed":
      return "text-st-green";
    case "blocked":
    case "failed":
    case "error":
      return "text-st-red";
    case "fixing":
      return "text-st-amber";
    case "running":
    case "implementing":
    case "reviewing":
    case "validating":
    case "committing":
      return "text-th-primary";
    default:
      return "text-th-dimmed";
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
    case "passed":
      return "bg-st-green text-st-green border border-st-green";
    case "blocked":
    case "failed":
    case "error":
      return "bg-st-red text-st-red border border-st-red";
    case "fixing":
      return "bg-st-amber text-st-amber border border-st-yellow";
    default:
      return "bg-th-muted text-th-secondary border border-th";
  }
}

const COMPACT_PROSE_CLASSES =
  "prose prose-sm max-w-none break-words text-th-secondary text-xs [&_p]:my-0.5 [&_p]:leading-relaxed [&_ul]:my-0.5 [&_ol]:my-0.5 [&_li]:my-0.5 [&_code]:bg-th-muted [&_code]:text-code-inline [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px]";

const PlanStepCard = memo(function PlanStepCard({
  step,
  busy,
  editable,
  onUpdateStep,
}: {
  step: PlanStep;
  busy: boolean;
  editable?: boolean;
  onUpdateStep: (step: PlanStep, fields: PlanStepEditableFields) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: step.title,
    objective_md: step.objective_md,
    risk_level: step.risk_level,
    requires_architecture_review: Boolean(step.requires_architecture_review),
    requires_security_review: Boolean(step.requires_security_review),
  });
  const events = step.events?.filter((event) => GATE_LABELS[event.phase]) || [];
  const runningEvent = events.find((event) => event.status === "running");
  const latestDetailedEvent = [...events].reverse().find((event) => (
    event.summary_md && event.summary_md !== GATE_LABELS[event.phase]
  ));
  const hasDraftChanges = draft.title !== step.title ||
    draft.objective_md !== step.objective_md ||
    draft.risk_level !== step.risk_level ||
    draft.requires_architecture_review !== Boolean(step.requires_architecture_review) ||
    draft.requires_security_review !== Boolean(step.requires_security_review);

  useEffect(() => {
    setDraft({
      title: step.title,
      objective_md: step.objective_md,
      risk_level: step.risk_level,
      requires_architecture_review: Boolean(step.requires_architecture_review),
      requires_security_review: Boolean(step.requires_security_review),
    });
    setEditing(false);
  }, [step.id, step.objective_md, step.requires_architecture_review, step.requires_security_review, step.risk_level, step.title]);

  const handleSave = async () => {
    const saved = await onUpdateStep(step, {
      title: draft.title.trim(),
      objective_md: draft.objective_md.trim(),
      risk_level: draft.risk_level,
      requires_architecture_review: draft.requires_architecture_review,
      requires_security_review: draft.requires_security_review,
    });
    if (saved) setEditing(false);
  };

  return (
    <div className="rounded-lg border border-th bg-th-main p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-th bg-th-muted text-meta font-semibold text-st-green">
          {step.position + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-th-primary truncate">{step.title}</p>
            <span className={`ml-auto text-meta font-semibold ${statusTextClass(step.status)}`}>{step.status}</span>
            {editable && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md p-1 text-th-muted hover:text-th-primary hover:bg-th-muted transition-colors"
                title="Edit step"
                aria-label="Edit step"
              >
                <PencilSimple size={12} weight="bold" />
              </button>
            )}
          </div>
          {editing ? (
            <div className="mt-3 space-y-3 rounded-lg border border-th bg-th-subtle p-3">
              <label className="block space-y-1">
                <span className="text-meta font-medium text-th-secondary">Title</span>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                  className="w-full rounded-lg border border-th bg-th-main px-2 py-1.5 text-xs text-th-primary focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-meta font-medium text-th-secondary">Description</span>
                <textarea
                  value={draft.objective_md}
                  onChange={(event) => setDraft((prev) => ({ ...prev, objective_md: event.target.value }))}
                  rows={4}
                  className="w-full resize-y rounded-lg border border-th bg-th-main px-2 py-1.5 text-xs leading-relaxed text-th-primary focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-meta font-medium text-th-secondary">Risk</span>
                  <select
                    value={draft.risk_level}
                    onChange={(event) => setDraft((prev) => ({ ...prev, risk_level: event.target.value as PlanStep["risk_level"] }))}
                    className="w-full rounded-lg border border-th bg-th-main px-2 py-1.5 text-xs text-th-primary focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <div className="space-y-1">
                  <span className="text-meta font-medium text-th-secondary">Review gates</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <ReviewToggle
                      label="Architecture"
                      checked={draft.requires_architecture_review}
                      disabled={busy}
                      onChange={(checked) => setDraft((prev) => ({ ...prev, requires_architecture_review: checked }))}
                    />
                    <ReviewToggle
                      label="Security"
                      checked={draft.requires_security_review}
                      disabled={busy}
                      onChange={(checked) => setDraft((prev) => ({ ...prev, requires_security_review: checked }))}
                    />
                    <ReviewToggle label="Review" checked disabled />
                    <ReviewToggle label="QA" checked disabled />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft({
                      title: step.title,
                      objective_md: step.objective_md,
                      risk_level: step.risk_level,
                      requires_architecture_review: Boolean(step.requires_architecture_review),
                      requires_security_review: Boolean(step.requires_security_review),
                    });
                    setEditing(false);
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs text-th-muted hover:text-th-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy || !hasDraftChanges || !draft.title.trim()}
                  className="rounded-lg bg-btn-primary px-3 py-1.5 text-xs font-medium text-btn-primary hover:bg-btn-primary-hover disabled:opacity-50"
                >
                  {busy ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <>
              {step.objective_md && (
                <p className="mt-1 text-xs text-th-muted whitespace-pre-wrap leading-relaxed">{step.objective_md}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded-full bg-th-muted px-2 py-0.5 text-meta text-th-dimmed">{step.risk_level} risk</span>
                <span className={`rounded-full px-2 py-0.5 text-meta ${step.requires_architecture_review ? "bg-st-green text-st-green" : "bg-th-muted text-th-dimmed"}`}>
                  Architecture: {step.requires_architecture_review ? "required" : "off"}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-meta ${step.requires_security_review ? "bg-st-green text-st-green" : "bg-th-muted text-th-dimmed"}`}>
                  Security: {step.requires_security_review ? "required" : "off"}
                </span>
                <span className="rounded-full bg-st-green px-2 py-0.5 text-meta text-st-green">Review: always</span>
                <span className="rounded-full bg-st-green px-2 py-0.5 text-meta text-st-green">QA: always</span>
              </div>
            </>
          )}
          {events.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {events.map((event) => (
                <span key={event.id} className={`rounded-full px-2 py-0.5 text-meta font-medium ${statusBadgeClass(event.status)}`}>
                  {GATE_LABELS[event.phase]}: {event.status}
                </span>
              ))}
            </div>
          )}
          {runningEvent && (
            <p className="mt-2 text-xs text-th-muted">
              {GATE_LABELS[runningEvent.phase]} is running...
            </p>
          )}
          {latestDetailedEvent && (
            <div className="mt-2 rounded-lg border border-th bg-th-subtle px-2 py-1.5">
              <div className="mb-1 text-meta font-semibold uppercase tracking-wider text-th-dimmed">
                {GATE_LABELS[latestDetailedEvent.phase]} feedback
              </div>
              <div className={COMPACT_PROSE_CLASSES}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{latestDetailedEvent.summary_md}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function ReviewToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-center gap-1.5 rounded-lg border border-th bg-th-main px-2 py-1 text-meta text-th-secondary ${disabled ? "opacity-60" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="h-3 w-3 accent-brand-500"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}
