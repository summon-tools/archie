"use client";

import ChatInput from "@/components/ChatInput";
import ToolActivity from "@/components/ToolActivity";
import { ToolActivity as ToolActivityType } from "@/hooks/useConversation";
import type { AppFile } from "@/lib/types";
import type { EffortLevel } from "@/lib/effort";
import { tools } from "@/tools/registry";
import type { ToolState } from "@/tools/types";

interface ConversationInputProps {
  appId: number;
  toolActivities: ToolActivityType[];
  worktreeReady: boolean;
  inputText: string;
  setInputText: (v: string) => void;
  inputAttachments: AppFile[];
  setInputAttachments: (files: AppFile[]) => void;
  handleSendMessage: () => void;
  sending: boolean;
  isClaudeActive: boolean;
  handleStopClaude: () => void;
  selectedModel: string;
  selectedProvider: string;
  selectedEffort: EffortLevel;
  handleModelChange: (provider: string, model: string) => void;
  handleEffortChange: (effort: EffortLevel) => void;
  availableModels?: { id: string; label: string; provider: string }[];
  toolStates?: Map<string, ToolState>;
  pinnedToolId?: string | null;
  onPinTool?: (toolId: string | null) => void;
  branchName?: string | null;
  isWorktree?: boolean;
}

export default function ConversationInput({
  appId,
  toolActivities,
  worktreeReady,
  inputText,
  setInputText,
  inputAttachments,
  setInputAttachments,
  handleSendMessage,
  sending,
  isClaudeActive,
  handleStopClaude,
  selectedModel,
  selectedProvider,
  selectedEffort,
  handleModelChange,
  handleEffortChange,
  availableModels,
  toolStates,
  pinnedToolId,
  onPinTool,
  branchName,
  isWorktree,
}: ConversationInputProps) {
  if (!worktreeReady) return null;

  const anyToolBusy = toolStates
    ? Array.from(toolStates.values()).some((s) => s.busy)
    : false;
  const busyTool = toolStates
    ? Array.from(toolStates.entries()).find(([, s]) => s.busy)
    : undefined;
  const isBusy = sending || isClaudeActive || anyToolBusy;

  return (
    <div>
      {toolActivities.length > 0 && (
        <div className="max-w-chat mx-auto px-4 pb-2 flex flex-wrap gap-1.5">
          {toolActivities.map((a, i) => (
            <ToolActivity key={`${a.kind}-${a.tool}-${i}`} kind={a.kind} tool={a.tool} summary={a.summary} active={a.active} />
          ))}
        </div>
      )}

      <ChatInput
        value={inputText}
        onChange={setInputText}
        onSubmit={handleSendMessage}
        placeholder={isClaudeActive ? "Send a message to the AI..." : "Message..."}
        disabled={isBusy}
        isLoading={isBusy}
        showStopButton={isClaudeActive || anyToolBusy}
        onStop={busyTool ? busyTool[1].cancel : handleStopClaude}
        model={selectedModel}
        provider={selectedProvider}
        effort={selectedEffort}
        onModelChange={handleModelChange}
        onEffortChange={handleEffortChange}
        availableModels={availableModels}
        tools={tools}
        pinnedToolId={pinnedToolId}
        onPinTool={onPinTool}
        toolsBusy={isBusy}
        branchName={branchName}
        isWorktree={isWorktree}
        appId={appId}
        attachments={inputAttachments}
        onAttachmentsChange={setInputAttachments}
      />
    </div>
  );
}
