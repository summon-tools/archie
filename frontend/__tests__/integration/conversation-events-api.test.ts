import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/server/dal", () => ({ getSessionForConversation: () => ({ status: "idle" }) }));
vi.mock("@/lib/server/conversation", () => ({ getConversationMessages: () => [] }));
vi.mock("@/lib/server/file-storage", () => ({ serializeAppFile: (file: unknown) => file }));
vi.mock("@/lib/server/route-utils", () => ({
  requireConversationAccess: async () => ({ app: { id: 1 }, conversation: { id: 2 } }),
  handleRouteError: () => null,
}));

let shutdown: () => void;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  delete (globalThis as any).__archieShutdownController;
  delete (globalThis as any)._conversationEventBus;
  vi.spyOn(process, "once").mockImplementation(((signal: string, handler: () => void) => {
    if (signal === "SIGTERM") shutdown = handler;
    return process;
  }) as typeof process.once);
});

afterEach(() => {
  delete (globalThis as any).__archieShutdownController;
  delete (globalThis as any)._conversationEventBus;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openEvents(signal?: AbortSignal) {
  const { GET } = await import("@/app/api/apps/[appId]/conversations/[conversationId]/events/route");
  const response = await GET(new NextRequest("http://localhost/api/apps/1/conversations/2/events", { signal }), {
    params: Promise.resolve({ appId: "1", conversationId: "2" }),
  });
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: status");
  expect(vi.getTimerCount()).toBe(1);
  return reader;
}

describe("conversation events response cleanup", () => {
  it("closes a connected browser's stream and releases subscriptions on shutdown", async () => {
    const reader = await openEvents();
    const pendingRead = reader.read();
    shutdown();
    await expect(pendingRead).resolves.toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
    expect((globalThis as any)._conversationEventBus.subscribers.size).toBe(0);
  });

  it("releases subscriptions and heartbeat timers when the browser cancels its reader", async () => {
    const reader = await openEvents();
    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
    expect((globalThis as any)._conversationEventBus.subscribers.size).toBe(0);
    shutdown();
  });
});
