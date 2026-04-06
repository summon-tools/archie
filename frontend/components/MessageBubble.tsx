"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SpinnerGap } from "@phosphor-icons/react";

import { PROSE_CLASSES } from "@/lib/prose";

/**
 * During streaming, some models (GPT) send each thinking line separated by
 * double newlines, which markdown renders as separate paragraphs with too
 * much spacing. This collapses consecutive plain-text lines (not code blocks,
 * headers, lists, etc.) into a single paragraph.
 */
function collapseThinkingLines(text: string): string {
  // Split into blocks separated by blank lines
  const blocks = text.split(/\n\n+/);
  const result: string[] = [];
  let plainRun: string[] = [];

  const flushPlain = () => {
    if (plainRun.length > 0) {
      result.push(plainRun.join(" "));
      plainRun = [];
    }
  };

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // Detect structured markdown: code fences, headers, lists, tables, blockquotes, HRs
    const isStructured = /^(```|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\||\s{4,}|---)/.test(trimmed);
    if (isStructured) {
      flushPlain();
      result.push(trimmed);
    } else {
      plainRun.push(trimmed);
    }
  }
  flushPlain();

  return result.join("\n\n");
}

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  isMarkdown?: boolean;
  isStreaming?: boolean;
  messageType?: string;
  senderName?: string | null;
  senderColor?: string | null;
}

export default function MessageBubble({
  role,
  content,
  timestamp,
  isMarkdown = false,
  isStreaming = false,
  messageType,
  senderName,
  senderColor,
}: MessageBubbleProps) {
  if (role === "system") {
    return (
      <div className="flex justify-center animate-fadeIn">
        <span className="text-meta text-th-dimmed font-medium">
          {content}
        </span>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className="flex justify-end animate-fadeIn">
        <div className="max-w-[80%] bg-th-muted text-th-primary rounded-2xl rounded-tr-sm px-4 py-2.5 overflow-hidden">
          <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ overflowWrap: "anywhere" }}>{content}</p>
        </div>
      </div>
    );
  }

  // Assistant — flat conversation style, no bubble
  return (
    <div className="animate-fadeIn" style={{ overflowWrap: "anywhere" }}>
      {isStreaming && content && (
        <div className="mb-1.5">
          <span className="text-meta text-st-green animate-pulse">
            writing...
          </span>
        </div>
      )}

      {/* Content */}
      {content ? (
        isMarkdown ? (
          <div className={PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {collapseThinkingLines(content)}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap leading-relaxed text-th-secondary">
            {content}
          </p>
        )
      ) : isStreaming ? (
        <div className="flex items-center gap-2 text-th-dimmed text-sm">
          <SpinnerGap size={13} className="animate-spin" />
          <span className="text-secondary">Thinking...</span>
        </div>
      ) : null}
    </div>
  );
}
