"use client";

import { useState, useRef, useEffect } from "react";

export function useAutoScroll(deps: unknown[]) {
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScroll, ...deps]);

  return { autoScroll, setAutoScroll, logEndRef };
}
