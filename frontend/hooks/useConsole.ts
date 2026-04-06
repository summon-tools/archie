"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getWsUrl } from "@/lib/ws-client";

interface UseConsoleOptions {
  processId: number | null;
}

export function useConsole({ processId }: UseConsoleOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [content, setContent] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [processStatus, setProcessStatus] = useState<string>("unknown");

  const connect = useCallback(async () => {
    if (!processId) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const url = await getWsUrl(`/ws/console/${processId}`);
    if (!mountedRef.current) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "history":
            setContent(msg.data);
            break;
          case "output":
            setContent((prev) => prev + msg.data);
            break;
          case "status":
            setProcessStatus(msg.status);
            break;
          case "exited":
            setProcessStatus("stopped");
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      // Auto-reconnect after 3s
      if (mountedRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, 3000);
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }, [processId]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { content, isConnected, processStatus };
}
