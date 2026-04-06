/**
 * Shared SSE (Server-Sent Events) stream parser for client-side hooks.
 */

export interface SSEEvent {
  event: string;
  data: any;
}

/**
 * Parse an SSE stream from a fetch Response, calling the handler for each event.
 * Handles buffering, keepalive comments, and abort signals.
 */
export async function consumeSSEStream(
  response: Response,
  handler: (event: SSEEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) { reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        if (!chunk.trim() || chunk.startsWith(":")) continue;
        let eventType = "";
        let dataStr = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataStr += line.slice(6);
        }
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr);
          await handler({ event: eventType, data: parsed });
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}
