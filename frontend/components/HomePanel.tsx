"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowSquareOut, ChatsCircle, CheckCircle, CircleNotch, PaperPlaneTilt, Plus, Sparkle, UsersThree } from "@phosphor-icons/react";
import { createRoom, sendRoomMessage } from "@/lib/api";
import { fetcher } from "@/lib/swr";
import type { HomeRoom, RoomMessage, Task } from "@/lib/types";
import { DEFAULT_HOME_AGENTS } from "@/lib/home/agents";

interface HomePanelProps {
  appId: number;
  workItems: Task[];
  onOpenConversation: (itemId: number) => void;
}

export default function HomePanel({ appId, workItems, onOpenConversation }: HomePanelProps) {
  const { data, mutate, isLoading } = useSWR<{ rooms: HomeRoom[] }>(`/api/apps/${appId}/rooms`, fetcher);
  const rooms = data?.rooms || [];
  const [activeTab, setActiveTab] = useState<"rooms" | "conversations">("rooms");
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  const selectedRoom = useMemo(() => {
    return rooms.find((room) => room.id === selectedRoomId) || rooms[0] || null;
  }, [rooms, selectedRoomId]);
  const { data: messagesData, mutate: mutateMessages } = useSWR<{ messages: RoomMessage[] }>(
    selectedRoom ? `/api/apps/${appId}/rooms/${selectedRoom.id}/messages` : null,
    fetcher,
  );
  const messages = messagesData?.messages || [];

  const activeWorkItems = workItems.filter((item) => item.status !== "done");
  const completedWorkItems = workItems.filter((item) => item.status === "done");

  const handleCreateRoom = async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const room = await createRoom(appId, {
        title: `Planning Room ${rooms.length + 1}`,
        purpose: "Plan and coordinate project work before creating implementation tasks.",
      });
      setSelectedRoomId(room.id);
      await mutate();
      setActiveTab("rooms");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setCreating(false);
    }
  };

  const handleSendRoomMessage = async () => {
    if (!selectedRoom || !messageDraft.trim() || sendingMessage) return;
    const content = messageDraft.trim();
    setSendingMessage(true);
    setMessageError(null);
    setMessageDraft("");
    try {
      await sendRoomMessage(appId, selectedRoom.id, content);
      await mutateMessages();
      await mutate();
    } catch (err) {
      setMessageDraft(content);
      setMessageError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSendingMessage(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 bg-th-main flex">
      <aside className="w-72 border-r border-th bg-th-panel flex flex-col min-h-0">
        <div className="p-4 border-b border-th">
          <p className="text-meta font-semibold text-th-dimmed uppercase tracking-wider mb-2">Home</p>
          <h1 className="text-xl font-semibold text-th-primary tracking-tight">Project control</h1>
          <p className="mt-1 text-sm text-th-muted">
            Plan work in rooms, then launch scoped implementation conversations.
          </p>
        </div>

        <div className="p-3 border-b border-th">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-th-muted p-1">
            <button
              onClick={() => setActiveTab("rooms")}
              className={`px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === "rooms" ? "bg-th-elevated text-th-primary shadow-sm" : "text-th-muted hover:text-th-primary"
              }`}
            >
              Rooms
            </button>
            <button
              onClick={() => setActiveTab("conversations")}
              className={`px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === "conversations" ? "bg-th-elevated text-th-primary shadow-sm" : "text-th-muted hover:text-th-primary"
              }`}
            >
              Tasks
            </button>
          </div>
        </div>

        {activeTab === "rooms" ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-3">
              <button
                onClick={handleCreateRoom}
                disabled={creating}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-th px-3 py-2 text-sm font-medium text-th-secondary hover:text-th-primary hover:bg-th-subtle disabled:opacity-60 transition-colors"
              >
                {creating ? <CircleNotch size={15} className="animate-spin" /> : <Plus size={15} weight="bold" />}
                New room
              </button>
              {createError && <p className="mt-2 text-xs text-st-red">{createError}</p>}
            </div>

            {isLoading ? (
              <div className="px-4 py-6 text-sm text-th-muted">Loading rooms...</div>
            ) : rooms.length === 0 ? (
              <div className="px-4 py-6 text-sm text-th-muted">
                No rooms yet. Create one to plan larger work before implementation.
              </div>
            ) : (
              <div className="pb-3">
                {rooms.map((room) => {
                  const isSelected = selectedRoom?.id === room.id;
                  return (
                    <button
                      key={room.id}
                      onClick={() => setSelectedRoomId(room.id)}
                      className={`w-full text-left px-4 py-3 border-l-2 transition-colors ${
                        isSelected
                          ? "border-l-th-strong bg-th-muted"
                          : "border-l-transparent hover:bg-th-subtle"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <UsersThree size={16} className="text-th-muted flex-shrink-0" />
                        <p className="text-sm font-medium text-th-primary truncate">{room.title}</p>
                      </div>
                      {room.purpose && (
                        <p className="mt-1 text-xs text-th-muted line-clamp-2 pl-6">{room.purpose}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ConversationGroup
              label="Active"
              items={activeWorkItems}
              emptyText="No active task conversations."
              onOpenConversation={onOpenConversation}
            />
            <ConversationGroup
              label="Completed"
              items={completedWorkItems}
              emptyText="No completed task conversations."
              onOpenConversation={onOpenConversation}
            />
          </div>
        )}
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {selectedRoom ? (
          <RoomShell
            room={selectedRoom}
            messages={messages}
            draft={messageDraft}
            setDraft={setMessageDraft}
            sending={sendingMessage}
            error={messageError}
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

      <aside className="w-80 border-l border-th bg-th-panel flex flex-col min-h-0">
        <div className="p-4 border-b border-th">
          <p className="text-meta font-semibold text-th-dimmed uppercase tracking-wider mb-2">Plan</p>
          <h2 className="text-base font-semibold text-th-primary">Execution outline</h2>
          <p className="mt-1 text-sm text-th-muted">
            Plan steps and execution progress will live here.
          </p>
        </div>
        <div className="p-4 space-y-3">
          <PlanPlaceholder label="Draft plan" />
          <PlanPlaceholder label="Step gates" />
          <PlanPlaceholder label="Linked task conversations" />
        </div>
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
  error,
  onSend,
}: {
  room: HomeRoom;
  messages: RoomMessage[];
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  error: string | null;
  onSend: () => void;
}) {
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

          <div className="pt-2">
            <p className="text-meta font-semibold text-th-dimmed uppercase tracking-wider mb-3">Default agent team</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {DEFAULT_HOME_AGENTS.map((agent) => (
                <div key={agent.key} className="rounded-lg border border-th bg-th-panel p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-th-strong" />
                    <h3 className="text-sm font-semibold text-th-primary">{agent.name}</h3>
                    <span className="ml-auto text-meta text-th-dimmed">{agent.defaultModel}</span>
                  </div>
                  <p className="text-xs text-th-muted leading-relaxed">{agent.role}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-th p-4">
        <div className="max-w-3xl mx-auto">
          {error && <p className="mb-2 text-sm text-st-red">{error}</p>}
          <div className="flex items-end gap-2 rounded-xl border border-th bg-th-panel p-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder="Discuss the plan..."
              rows={2}
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-th-primary placeholder:text-th-dimmed focus:outline-none"
              disabled={sending}
            />
            <button
              onClick={onSend}
              disabled={!draft.trim() || sending}
              className="h-9 w-9 rounded-lg bg-btn-primary text-btn-primary flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              title="Send message"
            >
              {sending ? <CircleNotch size={16} className="animate-spin" /> : <PaperPlaneTilt size={16} weight="bold" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoomMessageBubble({ message }: { message: RoomMessage }) {
  const isUser = message.role === "user";
  const label = isUser ? "You" : message.agent_key ? formatAgentLabel(message.agent_key) : "Archie";

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
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.body_md}</p>
      </div>
    </div>
  );
}

function formatAgentLabel(agentKey: string): string {
  return agentKey
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ConversationGroup({
  label,
  items,
  emptyText,
  onOpenConversation,
}: {
  label: string;
  items: Task[];
  emptyText: string;
  onOpenConversation: (itemId: number) => void;
}) {
  return (
    <section className="py-2">
      <p className="px-4 py-2 text-meta font-semibold text-th-dimmed uppercase tracking-wider">{label}</p>
      {items.length === 0 ? (
        <p className="px-4 py-2 text-xs text-th-muted">{emptyText}</p>
      ) : (
        <div>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onOpenConversation(item.id)}
              className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-th-subtle transition-colors"
            >
              {item.status === "done" ? <CheckCircle size={15} className="text-th-muted" /> : <ChatsCircle size={15} className="text-th-muted" />}
              <span className="text-sm text-th-primary truncate">{item.title}</span>
              <ArrowSquareOut size={13} className="ml-auto text-th-dimmed flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PlanPlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-th p-3">
      <p className="text-sm font-medium text-th-secondary">{label}</p>
      <p className="mt-1 text-xs text-th-muted">Coming in the next implementation slice.</p>
    </div>
  );
}
