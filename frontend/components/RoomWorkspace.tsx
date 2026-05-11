"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatsCircle, Flag, PlayCircle, Sparkle } from "@phosphor-icons/react";
import { advancePlanStepGate, createPlanStep, createRoomPlan, executeNextPlanStep, sendRoomMessage, startPlanStepGates, updateRoomPlan } from "@/lib/api";
import { fetcher } from "@/lib/swr";
import type { HomeRoom, PlanStep, RoomMessage, RoomPlanResponse, Task } from "@/lib/types";
import { DEFAULT_HOME_AGENTS } from "@/lib/home/agents";
import { PROSE_CLASSES } from "@/lib/prose";
import RoomChatInput from "@/components/RoomChatInput";
import { useResizablePanel } from "@/hooks/useResizablePanel";

interface RoomWorkspaceProps {
  appId: number;
  room: HomeRoom | null;
  onOpenConversation: (itemId: number) => void;
  onWorkItemCreated: (item: Task) => void;
}

export default function RoomWorkspace({ appId, room, onOpenConversation, onWorkItemCreated }: RoomWorkspaceProps) {
  const { leftWidth, isDragging, containerRef, dragHandleProps } = useResizablePanel({
    storageKey: "archie-room-plan-ratio",
    defaultWidth: 78,
    minWidth: 58,
    maxWidth: 84,
  });
  const [messageDraft, setMessageDraft] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<RoomMessage[]>([]);
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);
  const [awaitingReplyAfterId, setAwaitingReplyAfterId] = useState<number | null>(null);
  const [awaitingReplyStartedAt, setAwaitingReplyStartedAt] = useState<number | null>(null);
  const [awaitingReplyAgentKey, setAwaitingReplyAgentKey] = useState<string | null>(null);

  const { data: messagesData, mutate: mutateMessages } = useSWR<{ messages: RoomMessage[] }>(
    room ? `/api/apps/${appId}/rooms/${room.id}/messages` : null,
    fetcher,
    { refreshInterval: awaitingReplyAfterId ? 1500 : 0 },
  );
  const messages = messagesData?.messages || [];
  const visibleMessages = useMemo(() => {
    const persistedBodies = new Set(messages.map((message) => `${message.role}:${message.body_md}`));
    const pending = pendingMessages.filter((message) => (
      message.room_id === room?.id && !persistedBodies.has(`${message.role}:${message.body_md}`)
    ));
    return [...messages, ...pending];
  }, [messages, pendingMessages, room?.id]);

  const handleSendRoomMessage = async () => {
    if (!room || !messageDraft.trim() || sendingMessage) return;
    const content = messageDraft.trim();
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
    };
    setSendingMessage(true);
    setMessageError(null);
    setMessageDraft("");
    setPendingMessages((prev) => [...prev, optimisticMessage]);
    try {
      const message = await sendRoomMessage(appId, room.id, content, targetAgentKey);
      setPendingMessages((prev) => prev.filter((pending) => pending.id !== optimisticMessage.id));
      setSelectedAgentKey(null);
      setAwaitingReplyAfterId(message.id);
      setAwaitingReplyStartedAt(Date.now());
      setAwaitingReplyAgentKey(targetAgentKey || "coordinator");
      await mutateMessages();
    } catch (err) {
      setPendingMessages((prev) => prev.filter((pending) => pending.id !== optimisticMessage.id));
      setMessageDraft(content);
      setMessageError(err instanceof Error ? err.message : "Failed to send message");
      setAwaitingReplyAgentKey(null);
    } finally {
      setSendingMessage(false);
    }
  };

  useEffect(() => {
    if (!awaitingReplyAfterId) return;
    const hasReply = messages.some((message) => message.id > awaitingReplyAfterId && message.role === "agent");
    if (hasReply) {
      setAwaitingReplyAfterId(null);
      setAwaitingReplyStartedAt(null);
      setAwaitingReplyAgentKey(null);
      return;
    }

    if (awaitingReplyStartedAt && Date.now() - awaitingReplyStartedAt > 90000) {
      setAwaitingReplyAfterId(null);
      setAwaitingReplyStartedAt(null);
      const agentName = getAgentName(awaitingReplyAgentKey);
      setAwaitingReplyAgentKey(null);
      setMessageError(`${agentName} is taking longer than expected. Your message was saved; refresh the room or send another message to retry.`);
    }
  }, [awaitingReplyAfterId, awaitingReplyAgentKey, awaitingReplyStartedAt, messages]);

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
            sending={sendingMessage}
            thinking={Boolean(awaitingReplyAfterId)}
            error={messageError}
            selectedAgentKey={selectedAgentKey}
            setSelectedAgentKey={setSelectedAgentKey}
            thinkingAgentKey={awaitingReplyAgentKey}
            onSend={handleSendRoomMessage}
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
  sending,
  thinking,
  error,
  selectedAgentKey,
  setSelectedAgentKey,
  thinkingAgentKey,
  onSend,
}: {
  room: HomeRoom;
  messages: RoomMessage[];
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  thinking: boolean;
  error: string | null;
  selectedAgentKey: string | null;
  setSelectedAgentKey: (agentKey: string | null) => void;
  thinkingAgentKey: string | null;
  onSend: () => void;
}) {
  const statusAgentName = getAgentName(thinkingAgentKey || selectedAgentKey);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="px-6 py-4 border-b border-th">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-meta font-semibold text-th-dimmed uppercase tracking-wider mb-1">Room</p>
            <h2 className="text-xl font-semibold text-th-primary tracking-tight truncate">{room.title}</h2>
            {room.purpose && <p className="mt-1 text-sm text-th-muted">{room.purpose}</p>}
          </div>
          <span className="text-meta font-medium text-th-muted bg-th-muted rounded-full px-2 py-1">
            {room.status}
          </span>
        </div>
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
            <div className="space-y-4">
              {messages.map((message) => (
                <RoomMessageBubble key={message.id} message={message} />
              ))}
            </div>
          )}

        </div>
      </div>

      <div>
        {error && (
          <div className="max-w-chat mx-auto px-4 pt-3">
            <p className="text-sm text-st-red">{error}</p>
          </div>
        )}
        <RoomChatInput
          value={draft}
          onChange={setDraft}
          onSubmit={onSend}
          agents={DEFAULT_HOME_AGENTS}
          selectedAgentKey={selectedAgentKey}
          onSelectAgent={setSelectedAgentKey}
          disabled={sending}
          isLoading={sending}
          statusText={sending || thinking ? `${statusAgentName} is thinking...` : undefined}
        />
      </div>
    </div>
  );
}

function RoomMessageBubble({ message }: { message: RoomMessage }) {
  const isUser = message.role === "user";
  const label = isUser ? "You" : message.agent_key ? formatAgentLabel(message.agent_key) : "Archie";
  const taggedAgent = isUser ? getTaggedAgentName(message) : null;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-xl px-3 py-2 ${
        isUser ? "bg-btn-primary text-btn-primary" : "bg-th-panel border border-th text-th-primary"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-meta font-semibold ${isUser ? "text-btn-primary/80" : "text-th-dimmed"}`}>
            {label}
          </span>
          {message.kind !== "message" && (
            <span className={`text-meta ${isUser ? "text-btn-primary/70" : "text-th-dimmed"}`}>
              {message.kind.replace("_", " ")}
            </span>
          )}
          {taggedAgent && (
            <span className={`rounded-full px-1.5 py-0.5 text-meta font-medium ${
              isUser ? "bg-black/10 text-btn-primary/70" : "bg-th-muted text-th-dimmed"
            }`}>
              @{taggedAgent}
            </span>
          )}
        </div>
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.body_md}</p>
        ) : (
          <div className={PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.body_md}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function getTaggedAgentName(message: RoomMessage): string | null {
  if (!message.payload_json) return null;
  try {
    const payload = JSON.parse(message.payload_json) as { target_agent_key?: unknown };
    if (typeof payload.target_agent_key !== "string") return null;
    const agent = DEFAULT_HOME_AGENTS.find((candidate) => candidate.key === payload.target_agent_key);
    return agent?.name || null;
  } catch {
    return null;
  }
}

function getAgentName(agentKey: string | null): string {
  if (!agentKey) return "Coordinator";
  return DEFAULT_HOME_AGENTS.find((agent) => agent.key === agentKey)?.name || "Coordinator";
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
  onOpenConversation,
  onWorkItemCreated,
}: {
  appId: number;
  room: HomeRoom | null;
  onOpenConversation: (itemId: number) => void;
  onWorkItemCreated: (item: Task) => void;
}) {
  const { data, mutate, isLoading } = useSWR<RoomPlanResponse>(
    room ? `/api/apps/${appId}/rooms/${room.id}/plan` : null,
    fetcher,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepTitle, setStepTitle] = useState("");
  const [stepObjective, setStepObjective] = useState("");

  const plan = data?.plan || null;
  const steps = data?.steps || [];
  const activeStep = steps.find((step) => ["implementing", "reviewing", "fixing", "validating", "committing"].includes(step.status));
  const nextPendingStep = steps.find((step) => step.status === "pending");

  const handleCreatePlan = async () => {
    if (!room || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createRoomPlan(appId, room.id, {
        title: `${room.title} plan`,
        summary_md: room.purpose || "Structured execution plan for this room.",
      });
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
    } finally {
      setBusy(false);
    }
  };

  const handleExecuteNext = async () => {
    if (!room || !plan || busy) return;
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

  const handleStartGates = async (step: PlanStep) => {
    if (!room || busy) return;
    setBusy(true);
    setError(null);
    try {
      await startPlanStepGates(appId, room.id, step.id);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start review gates");
    } finally {
      setBusy(false);
    }
  };

  const handleAdvanceGate = async (step: PlanStep, status: "passed" | "failed") => {
    if (!room || busy) return;
    setBusy(true);
    setError(null);
    try {
      await advancePlanStepGate(appId, room.id, step.id, { status });
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to advance review gate");
    } finally {
      setBusy(false);
    }
  };

  const handleMarkReady = async () => {
    if (!room || !plan || busy) return;
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

  const handleCreateStep = async () => {
    if (!room || !plan || !stepTitle.trim() || busy) return;
    const title = stepTitle.trim();
    const objective = stepObjective.trim();
    setBusy(true);
    setError(null);
    setStepTitle("");
    setStepObjective("");
    try {
      await createPlanStep(appId, room.id, {
        title,
        objective_md: objective,
        implementation_prompt_md: objective,
        acceptance_criteria_md: "",
      });
      await mutate();
    } catch (err) {
      setStepTitle(title);
      setStepObjective(objective);
      setError(err instanceof Error ? err.message : "Failed to create plan step");
    } finally {
      setBusy(false);
    }
  };

  if (!room) {
    return (
      <div className="p-4">
        <p className="text-meta font-semibold text-th-dimmed uppercase tracking-wider mb-2">Plan</p>
        <p className="text-sm text-th-muted">Select a room to draft a structured plan.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="p-4 border-b border-th">
        <p className="text-meta font-semibold text-th-dimmed uppercase tracking-wider mb-2">Plan</p>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-th-primary flex-1 min-w-0 truncate">
            {plan?.title || "No plan yet"}
          </h2>
          {plan && (
            <span className="text-meta font-medium text-th-muted bg-th-muted rounded-full px-2 py-1">
              {plan.status}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-th-muted">
          Draft scoped steps before launching implementation conversations.
        </p>
        {plan && (
          <div className="mt-3">
            {activeStep?.linked_work_item_id ? (
              <button
                onClick={() => onOpenConversation(activeStep.linked_work_item_id!)}
                className="w-full rounded-lg border border-th px-3 py-2 text-sm font-medium text-th-secondary hover:text-th-primary hover:bg-th-subtle"
              >
                Open active task
              </button>
            ) : (
              <button
                onClick={handleExecuteNext}
                disabled={busy || !nextPendingStep || !["ready", "executing"].includes(plan.status)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-btn-primary text-btn-primary px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PlayCircle size={16} />
                {busy ? "Starting..." : "Execute next step"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {error && <p className="text-sm text-st-red">{error}</p>}

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
              onClick={handleCreatePlan}
              disabled={busy}
              className="mt-3 w-full rounded-lg bg-btn-primary text-btn-primary px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {busy ? "Creating..." : "Create draft plan"}
            </button>
          </div>
        ) : (
          <>
            {plan.summary_md && (
              <div className="rounded-lg border border-th bg-th-main p-3">
                <p className="text-xs text-th-muted leading-relaxed whitespace-pre-wrap">{plan.summary_md}</p>
              </div>
            )}

            <section>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-meta font-semibold text-th-dimmed uppercase tracking-wider">Steps</p>
                {plan.status === "draft" && steps.length > 0 && (
                  <button
                    onClick={handleMarkReady}
                    disabled={busy}
                    className="text-xs font-medium text-th-secondary hover:text-th-primary disabled:opacity-60"
                  >
                    Mark ready
                  </button>
                )}
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
                      onStartGates={handleStartGates}
                      onAdvanceGate={handleAdvanceGate}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-th bg-th-main p-3">
              <p className="text-sm font-medium text-th-secondary mb-2">Add step</p>
              <input
                value={stepTitle}
                onChange={(event) => setStepTitle(event.target.value)}
                placeholder="Step title"
                className="w-full rounded-lg border border-th bg-th-panel px-3 py-2 text-sm text-th-primary placeholder:text-th-dimmed focus:outline-none focus:border-th-strong"
                disabled={busy}
              />
              <textarea
                value={stepObjective}
                onChange={(event) => setStepObjective(event.target.value)}
                placeholder="Objective or implementation brief"
                rows={3}
                className="mt-2 w-full resize-none rounded-lg border border-th bg-th-panel px-3 py-2 text-sm text-th-primary placeholder:text-th-dimmed focus:outline-none focus:border-th-strong"
                disabled={busy}
              />
              <button
                onClick={handleCreateStep}
                disabled={!stepTitle.trim() || busy}
                className="mt-2 w-full rounded-lg border border-th px-3 py-2 text-sm font-medium text-th-secondary hover:text-th-primary hover:bg-th-subtle disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? "Saving..." : "Add step"}
              </button>
            </section>
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
  browser_validation: "Browser",
  commit: "Commit",
};

function PlanStepCard({
  step,
  busy,
  onStartGates,
  onAdvanceGate,
}: {
  step: PlanStep;
  busy: boolean;
  onStartGates: (step: PlanStep) => void;
  onAdvanceGate: (step: PlanStep, status: "passed" | "failed") => void;
}) {
  const gates = [
    step.requires_architecture_review ? "Architecture" : null,
    step.requires_security_review ? "Security" : null,
    step.requires_browser_validation ? "Browser" : null,
  ].filter(Boolean);
  const events = step.events?.filter((event) => GATE_LABELS[event.phase]) || [];
  const pendingEvent = events.find((event) => event.status === "pending");

  return (
    <div className="rounded-lg border border-th bg-th-main p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-th-muted text-meta font-semibold text-th-secondary">
          {step.position + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-th-primary truncate">{step.title}</p>
            <span className="ml-auto text-meta text-th-dimmed">{step.status}</span>
          </div>
          {step.objective_md && (
            <p className="mt-1 text-xs text-th-muted whitespace-pre-wrap leading-relaxed">{step.objective_md}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="rounded-full bg-th-muted px-2 py-0.5 text-meta text-th-dimmed">{step.risk_level} risk</span>
            {gates.map((gate) => (
              <span key={gate} className="rounded-full bg-th-muted px-2 py-0.5 text-meta text-th-dimmed">
                {gate}
              </span>
            ))}
          </div>
          {events.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {events.map((event) => (
                <span key={event.id} className="rounded-full bg-th-muted px-2 py-0.5 text-meta text-th-dimmed">
                  {GATE_LABELS[event.phase]}: {event.status}
                </span>
              ))}
            </div>
          )}
          {(step.status === "implementing" || step.status === "fixing") && step.linked_work_item_id && (
            <button
              onClick={() => onStartGates(step)}
              disabled={busy}
              className="mt-3 w-full rounded-lg border border-th px-3 py-2 text-xs font-medium text-th-secondary hover:text-th-primary hover:bg-th-subtle disabled:opacity-50"
            >
              Start review gates
            </button>
          )}
          {pendingEvent && ["reviewing", "validating", "committing"].includes(step.status) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => onAdvanceGate(step, "passed")}
                disabled={busy}
                className="rounded-lg border border-th px-3 py-2 text-xs font-medium text-th-secondary hover:text-th-primary hover:bg-th-subtle disabled:opacity-50"
              >
                Pass gate
              </button>
              <button
                onClick={() => onAdvanceGate(step, "failed")}
                disabled={busy}
                className="rounded-lg border border-th px-3 py-2 text-xs font-medium text-st-red hover:bg-th-subtle disabled:opacity-50"
              >
                Needs fixes
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
