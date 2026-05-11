"use client";

import { useState, useCallback, useRef, useEffect } from "react";

const STORAGE_KEY = "archie-panel-ratio";
const DEFAULT_WIDTH = 50;
const MIN_WIDTH = 30;
const MAX_WIDTH = 70;

interface ResizablePanelOptions {
  storageKey?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

export function useResizablePanel(options: ResizablePanelOptions = {}) {
  const storageKey = options.storageKey ?? STORAGE_KEY;
  const defaultWidth = options.defaultWidth ?? DEFAULT_WIDTH;
  const minWidth = options.minWidth ?? MIN_WIDTH;
  const maxWidth = options.maxWidth ?? MAX_WIDTH;

  const [leftWidth, setLeftWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= minWidth && val <= maxWidth) return val;
      }
    }
    return defaultWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(minWidth, Math.min(maxWidth, pct));
      setLeftWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setLeftWidth((w) => {
        localStorage.setItem(storageKey, String(w));
        return w;
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, maxWidth, minWidth, storageKey]);

  return {
    leftWidth,
    isDragging,
    containerRef,
    dragHandleProps: {
      onMouseDown,
      style: { cursor: "col-resize" } as React.CSSProperties,
    },
  };
}
