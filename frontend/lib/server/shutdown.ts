import { setMaxListeners } from "node:events";

const shutdownState = globalThis as typeof globalThis & {
  __archieShutdownController?: AbortController;
};

/** Shared across route bundles so every open stream receives the same shutdown signal. */
export function getServerShutdownSignal(): AbortSignal {
  if (!shutdownState.__archieShutdownController) {
    const controller = new AbortController();
    shutdownState.__archieShutdownController = controller;
    // Each open SSE connection registers a listener; more than ten is expected.
    setMaxListeners(0, controller.signal);
    const shutdown = () => controller.abort();
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }
  return shutdownState.__archieShutdownController.signal;
}

/** End long-lived HTTP responses so Next.js can finish its graceful shutdown. */
export function closeStreamOnShutdown<T>(
  controller: ReadableStreamDefaultController<T>,
  requestSignal?: AbortSignal,
  onClose: () => void = () => {},
): () => void {
  const shutdownSignal = getServerShutdownSignal();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    shutdownSignal.removeEventListener("abort", close);
    requestSignal?.removeEventListener("abort", close);
    try {
      onClose();
    } finally {
      try { controller.close(); } catch { /* Stream may already be cancelled. */ }
    }
  };
  shutdownSignal.addEventListener("abort", close, { once: true });
  requestSignal?.addEventListener("abort", close, { once: true });
  if (shutdownSignal.aborted || requestSignal?.aborted) close();
  return close;
}
