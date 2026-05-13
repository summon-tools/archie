/**
 * Conversation event bus for SSE push.
 *
 * Singleton Map on globalThis (survives HMR in dev).
 * Emits events when messages are created or session status changes.
 */

export interface ConversationMessageEvent {
  type: "message";
  id: number;
  message: {
    id: number;
    conversation_id: number;
    role: string;
    content: string;
    message_type: string;
    created_by_name: string | null;
    created_by_color: string | null;
    created_at: string;
    attachments?: unknown[];
  };
}

export interface ConversationStatusEvent {
  type: "status";
  id: number;
  status: string;
}

export type ConversationEvent = ConversationMessageEvent | ConversationStatusEvent;

/** Distributive Omit that works correctly over union types. */
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export type ConversationEventInput = DistributiveOmit<ConversationEvent, "id">;

type ConversationListener = (event: ConversationEvent) => void;

interface ConversationEventBus {
  subscribers: Map<number, Set<ConversationListener>>;
  seq: number;
}

function getBus(): ConversationEventBus {
  const g = globalThis as any;
  if (!g._conversationEventBus) {
    g._conversationEventBus = { subscribers: new Map(), seq: 0 };
  }
  return g._conversationEventBus;
}

/** Emit an event to all subscribers of a conversation. */
export function emitConversationEvent(conversationId: number, event: ConversationEventInput): void {
  const bus = getBus();
  bus.seq++;
  const fullEvent = { ...event, id: bus.seq } as ConversationEvent;
  const listeners = bus.subscribers.get(conversationId);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(fullEvent);
      } catch {
        // Don't let one listener break others
      }
    }
  }
}

/** Subscribe to events for a conversation. Returns an unsubscribe function. */
export function subscribeConversation(conversationId: number, listener: ConversationListener): () => void {
  const bus = getBus();
  let set = bus.subscribers.get(conversationId);
  if (!set) {
    set = new Set();
    bus.subscribers.set(conversationId, set);
  }
  set.add(listener);

  return () => {
    set!.delete(listener);
    if (set!.size === 0) {
      bus.subscribers.delete(conversationId);
    }
  };
}

/** Get the current sequence number (for Last-Event-ID staleness checks). */
export function getEventSeq(): number {
  return getBus().seq;
}
