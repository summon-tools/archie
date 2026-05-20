"use client";

import { ConversationErrorDiagnostic, ConversationMessage } from "@/lib/types";
import MessageBubble from "@/components/MessageBubble";
import SetupNextSteps from "@/components/SetupNextSteps";
import { WarningCircle, SpinnerGap } from "@phosphor-icons/react";
import { tools, getToolByMessageType } from "@/tools/registry";
import type { ToolState } from "@/tools/types";

const META_RE = /\n?<!-- meta: .+? -->\s*$/;

/** Strip the meta comment so it doesn't render as visible text */
function stripMeta(content: string) {
  return content.replace(META_RE, "");
}

interface SetupNextStepsData {
  show: boolean;
  appId: number;
  workItemId: number;
  branchName: string | null;
  prResult: { pr_url: string; pr_number: number } | null;
  pushing: boolean;
  creatingPR: boolean;
  publishing: boolean;
  onPublish: () => void;
  onPull: () => void;
  pulling: boolean;
  branchError: string | null;
  prUrl: string | null;
  onMarkDone: () => void;
  markedDone: boolean;
}

interface ConversationMessagesProps {
  messages: ConversationMessage[];
  streamContent: string;
  isClaudeActive: boolean;
  activeClaudeStatus: string | null;
  sending: boolean;
  description: string;
  title: string;
  worktreeStatus: string | null;
  handleRetry: () => void;
  lastError?: string | null;
  lastErrorDiagnostic?: ConversationErrorDiagnostic | null;
  logEndRef: React.RefObject<HTMLDivElement | null>;
  appId?: number;
  workItemId?: number;
  toolStates?: Map<string, ToolState>;
  setupNextSteps?: SetupNextStepsData;
}

export default function ConversationMessages({
  messages,
  streamContent,
  isClaudeActive,
  activeClaudeStatus,
  sending,
  description,
  title,
  worktreeStatus,
  handleRetry,
  lastError,
  lastErrorDiagnostic,
  logEndRef,
  appId,
  workItemId,
  toolStates,
  setupNextSteps,
}: ConversationMessagesProps) {
  return (
    <div className="flex-1 overflow-y-auto scroll-smooth">
      <div className="max-w-chat mx-auto px-6 py-6 space-y-8">
        {/* Task messages */}
        {messages.map((msg) => {
          // Check if this message type belongs to a tool
          const tool = getToolByMessageType(msg.message_type);
          if (tool) {
            return (
              <tool.ResultCard
                key={msg.id}
                content={msg.content}
                appId={appId || 0}
                itemId={workItemId || 0}
              />
            );
          }

          const displayContent = msg.role === "assistant" ? stripMeta(msg.content) : msg.content;
          return (
            <MessageBubble
              key={msg.id}
              role={msg.role as "user" | "assistant" | "system"}
              content={displayContent}
              isMarkdown={msg.role !== "system"}
              messageType={msg.message_type}
              senderName={msg.role === "user" ? msg.sender_label || msg.created_by_name : undefined}
              senderColor={msg.role === "user" ? msg.created_by_color : undefined}
              attachments={msg.attachments}
            />
          );
        })}

        {/* Streaming bubble */}
        {(streamContent || isClaudeActive || sending) && !activeClaudeStatus?.match(/^(completed|failed|stopped)$/) && (
          <MessageBubble
            role="assistant"
            content={streamContent}
            isMarkdown={!!streamContent}
            isStreaming={true}
          />
        )}

        {/* Active tool progress cards */}
        {toolStates && tools.map((tool) => {
          const state = toolStates.get(tool.id);
          if (!state?.busy) return null;
          return <tool.ProgressCard key={tool.id} progress={state.progress} />;
        })}

        {/* Failed state with retry */}
        {activeClaudeStatus === "failed" && (
          <div className="animate-fadeIn">
            <div className="flex items-start gap-2 text-st-red text-sm">
              <WarningCircle size={16} weight="bold" className="flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p>{lastError || "Something went wrong. The request could not be completed."}</p>
                {lastErrorDiagnostic && (
                  <details className="mt-2 max-w-2xl rounded-lg border border-th bg-th-elevated text-th-secondary">
                    <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-th-primary hover:text-th-primary">
                      Show technical details
                    </summary>
                    <div className="border-t border-th px-3 py-2 text-xs">
                      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[120px_1fr]">
                        <dt className="text-th-muted">Category</dt>
                        <dd className="break-words font-mono text-th-primary">{lastErrorDiagnostic.category || "unknown"}</dd>
                        <dt className="text-th-muted">Provider</dt>
                        <dd className="break-words font-mono text-th-primary">{lastErrorDiagnostic.provider_id || "unknown"}</dd>
                        <dt className="text-th-muted">Model</dt>
                        <dd className="break-words font-mono text-th-primary">{lastErrorDiagnostic.model_id || "unknown"}</dd>
                        <dt className="text-th-muted">Run</dt>
                        <dd className="break-words font-mono text-th-primary">{lastErrorDiagnostic.run_id ? `#${lastErrorDiagnostic.run_id}` : "unknown"}</dd>
                      </dl>
                      {lastErrorDiagnostic.detail && (
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-th bg-th-main p-2 font-mono text-[11px] leading-relaxed text-th-secondary">
                          {lastErrorDiagnostic.detail}
                        </pre>
                      )}
                    </div>
                  </details>
                )}
                <button
                  onClick={handleRetry}
                  disabled={sending}
                  className="mt-2 text-xs text-th-muted hover:text-th-primary underline underline-offset-2 disabled:opacity-50 transition-colors"
                >
                  {sending ? "Retrying..." : "Retry"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stopped state (user-initiated) */}
        {activeClaudeStatus === "stopped" && (
          <div className="flex justify-center animate-fadeIn">
            <span className="text-meta text-th-dimmed font-medium">
              Stopped — send a message to continue
            </span>
          </div>
        )}

        {/* Worktree preparing: show user's task description + setup indicator */}
        {messages.length === 0 && worktreeStatus === "preparing" && description && (
          <>
            <MessageBubble role="user" content={description} />
            <div className="flex justify-center animate-fadeIn">
              <div className="flex items-center gap-2 px-4 py-2 bg-th-muted rounded-full">
                <SpinnerGap size={14} className="animate-spin text-th-muted" />
                <span className="text-xs text-th-muted">Setting up workspace...</span>
              </div>
            </div>
          </>
        )}

        {/* Empty state */}
        {messages.length === 0 && !isClaudeActive && !sending && !streamContent && worktreeStatus !== "preparing" && (
          <div className="flex items-center justify-center h-32">
            <p className="text-secondary text-th-dimmed">Send a message to get started</p>
          </div>
        )}

        {/* Setup next steps card — shown when setup task completes */}
        {setupNextSteps?.show && (
          <SetupNextSteps
            appId={setupNextSteps.appId}
            workItemId={setupNextSteps.workItemId}
            branchName={setupNextSteps.branchName}
            prResult={setupNextSteps.prResult}
            pushing={setupNextSteps.pushing}
            creatingPR={setupNextSteps.creatingPR}
            publishing={setupNextSteps.publishing}
            onPublish={setupNextSteps.onPublish}
            onPull={setupNextSteps.onPull}
            pulling={setupNextSteps.pulling}
            branchError={setupNextSteps.branchError}
            prUrl={setupNextSteps.prUrl}
            onMarkDone={setupNextSteps.onMarkDone}
            markedDone={setupNextSteps.markedDone}
          />
        )}

        <div ref={logEndRef} />
      </div>
    </div>
  );
}
