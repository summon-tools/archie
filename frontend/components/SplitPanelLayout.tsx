"use client";

import { ReactNode } from "react";
import { useResizablePanel } from "@/hooks/useResizablePanel";

interface SplitPanelLayoutProps {
  chatPanel: ReactNode;
  previewPanel: ReactNode;
}

export default function SplitPanelLayout({
  chatPanel,
  previewPanel,
}: SplitPanelLayoutProps) {
  const { leftWidth, isDragging, containerRef, dragHandleProps } =
    useResizablePanel();

  return (
    <div className="flex h-full" ref={containerRef}>
      {/* Chat panel */}
      <div
        className="h-full min-w-0 flex flex-col"
        style={{ width: `${leftWidth}%` }}
      >
        {chatPanel}
      </div>

      {/* Drag handle */}
      <div
        className={`w-1 flex-shrink-0 relative group transition-colors ${
          isDragging
            ? "bg-brand-400/40"
            : "bg-th-subtle hover:bg-brand-400/30"
        }`}
        {...dragHandleProps}
      >
        {/* Visual indicator */}
        <div
          className={`absolute inset-y-0 -left-0.5 -right-0.5 ${
            isDragging ? "" : "group-hover:bg-brand-400/10"
          }`}
        />
      </div>

      {/* Preview panel */}
      <div
        className="h-full min-w-0 flex flex-col"
        style={{
          width: `${100 - leftWidth}%`,
          pointerEvents: isDragging ? "none" : undefined,
        }}
      >
        {previewPanel}
      </div>
    </div>
  );
}
