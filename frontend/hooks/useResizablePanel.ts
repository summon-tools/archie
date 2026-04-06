"use client";

import { useState, useCallback, useRef, useEffect } from "react";

const STORAGE_KEY = "archie-panel-ratio";
const DEFAULT_WIDTH = 50;
const MIN_WIDTH = 30;
const MAX_WIDTH = 70;

export function useResizablePanel() {
  const [leftWidth, setLeftWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= MIN_WIDTH && val <= MAX_WIDTH) return val;
      }
    }
    return DEFAULT_WIDTH;
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
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, pct));
      setLeftWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setLeftWidth((w) => {
        localStorage.setItem(STORAGE_KEY, String(w));
        return w;
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

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
