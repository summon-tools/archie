import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";

const signalHandlers = new Map<string, () => void>();

beforeEach(() => {
  vi.resetModules();
  signalHandlers.clear();
  delete (globalThis as any).__archieShutdownController;
  vi.spyOn(process, "once").mockImplementation(((signal: string, handler: () => void) => {
    signalHandlers.set(signal, handler);
    return process;
  }) as typeof process.once);
});

afterEach(() => {
  delete (globalThis as any).__archieShutdownController;
  vi.restoreAllMocks();
});

describe("server stream shutdown", () => {
  it.each(["SIGTERM", "SIGINT"])("ends open responses on %s without waiting for client disconnect", async (signal) => {
    const { closeStreamOnShutdown, getServerShutdownSignal } = await import("@/lib/server/shutdown");
    const onClose = vi.fn();
    const client = new AbortController();
    const streams = Array.from({ length: 2 }, () => new ReadableStream({
      start(controller) {
        closeStreamOnShutdown(controller, client.signal, onClose);
      },
    }));
    const reads = streams.map((stream) => stream.getReader().read());

    signalHandlers.get(signal)!();

    await expect(Promise.all(reads)).resolves.toEqual([
      { done: true, value: undefined },
      { done: true, value: undefined },
    ]);
    expect(client.signal.aborted).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(getEventListeners(getServerShutdownSignal(), "abort")).toHaveLength(0);
    expect(getEventListeners(client.signal, "abort")).toHaveLength(0);
  });

  it("cleans up cancelled readers once and unregisters the shutdown listener", async () => {
    const { closeStreamOnShutdown, getServerShutdownSignal } = await import("@/lib/server/shutdown");
    const onClose = vi.fn();
    let close = () => {};
    const stream = new ReadableStream({
      start(controller) { close = closeStreamOnShutdown(controller, undefined, onClose); },
      cancel() { close(); },
    });
    await stream.cancel();
    signalHandlers.get("SIGTERM")!();
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getEventListeners(getServerShutdownSignal(), "abort")).toHaveLength(0);
  });

  it("ends the response when its client disconnects", async () => {
    const { closeStreamOnShutdown } = await import("@/lib/server/shutdown");
    const client = new AbortController();
    const onClose = vi.fn();
    const stream = new ReadableStream({
      start(controller) { closeStreamOnShutdown(controller, client.signal, onClose); },
    });
    const read = stream.getReader().read();
    client.abort();
    await expect(read).resolves.toEqual({ done: true, value: undefined });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("immediately ends streams opened after shutdown has begun", async () => {
    const { closeStreamOnShutdown, getServerShutdownSignal } = await import("@/lib/server/shutdown");
    getServerShutdownSignal();
    signalHandlers.get("SIGTERM")!();
    const onClose = vi.fn();
    const stream = new ReadableStream({
      start(controller) { closeStreamOnShutdown(controller, undefined, onClose); },
    });
    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shares a single shutdown signal across separately loaded route modules", async () => {
    const first = await import("@/lib/server/shutdown");
    const signal = first.getServerShutdownSignal();
    vi.resetModules();
    const second = await import("@/lib/server/shutdown");
    expect(second.getServerShutdownSignal()).toBe(signal);
    expect(process.once).toHaveBeenCalledTimes(2);
  });
});
