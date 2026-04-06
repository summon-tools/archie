# Building Tools

Tools are high-level capabilities that the agent can invoke during a conversation. They go beyond code generation — a tool can interact with the running preview, populate a database, record a video, or run any custom workflow your team needs.

This guide covers how to create a new tool and register it in Archie.

## Anatomy of a Tool

Every tool lives in its own folder under `frontend/tools/` and consists of two files:

```
frontend/tools/
  my-tool/
    definition.ts   ← static metadata (server-safe, no React)
    index.tsx        ← React hook + UI components (client-side)
```

Plus two registry files where you add your tool:

```
frontend/tools/
  definitions.ts    ← server-safe list of all tool definitions
  registry.ts       ← client-side list of all full tools
```

## Step 1: Create the Definition

The definition file describes your tool's identity and tells the agent when to use it. It has no React dependencies, so it can be imported from server-side code.

Create `frontend/tools/my-tool/definition.ts`:

```typescript
import type { ToolDefinition } from "../types";

export const myToolDefinition: ToolDefinition = {
  id: "my-tool",
  name: "My Tool",
  description: "Short description shown in the tools dropdown",
  intentKeywords:
    "Detailed guide for the AI to recognize when this tool should be used. " +
    "Include example phrases users might say, and clarify what this tool " +
    "does NOT do to avoid false matches with other tools.",
  messageType: "my-tool",
};
```

| Field | Purpose |
|---|---|
| `id` | Unique identifier, used for lookups |
| `name` | Display name in the UI |
| `description` | Short label for the tools menu |
| `intentKeywords` | Detailed text the agent uses to decide whether to invoke this tool. Be specific — include example trigger phrases and negative examples. |
| `messageType` | The `type` value saved on messages produced by this tool. Used to render the correct result card when loading conversation history. |

## Step 2: Implement the Tool

The implementation file is a `"use client"` React module that exports the tool's logic and UI.

Create `frontend/tools/my-tool/index.tsx`:

```typescript
"use client";

import { useState, useRef, useCallback } from "react";
import { Wrench } from "@phosphor-icons/react";
import type { Tool, ToolContext, ToolState } from "../types";
import { myToolDefinition } from "./definition";

// ── Hook ──────────────────────────────────────────────

function useMyTool(ctx: ToolContext): ToolState {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const execute = useCallback(async (input: string) => {
    if (busy) return;
    setBusy(true);
    setProgress("Working...");

    try {
      // Your tool logic here.
      // Use ctx.appId, ctx.itemId, ctx.workItem, ctx.iframeRef, etc.

      // Save the result as a message in the conversation:
      await ctx.saveMessage(
        JSON.stringify({ result: "done" }),
        "assistant",
        "my-tool", // must match messageType in the definition
      );
      await ctx.reloadMessages();
    } catch (err) {
      await ctx.saveMessage(
        JSON.stringify({ error: String(err) }),
        "assistant",
        "my-tool",
      );
      await ctx.reloadMessages();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, ctx]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setProgress(null);
  }, []);

  return { execute, cancel, busy, progress };
}

// ── Progress Card ─────────────────────────────────────

function MyToolProgress({ progress }: { progress: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm text-th-secondary">
      <Wrench size={14} className="animate-spin" />
      <span>{progress ?? "Running..."}</span>
    </div>
  );
}

// ── Result Card ───────────────────────────────────────

function MyToolResult({ content }: { content: string; appId: number; itemId: number }) {
  let data: { result?: string; error?: string } = {};
  try { data = JSON.parse(content); } catch {}

  if (data.error) {
    return <p className="text-sm text-red-400">{data.error}</p>;
  }
  return <p className="text-sm text-th-secondary">Done: {data.result}</p>;
}

// ── Export ─────────────────────────────────────────────

export const myTool: Tool = {
  ...myToolDefinition,
  icon: Wrench,
  useTool: useMyTool,
  ProgressCard: MyToolProgress,
  ResultCard: MyToolResult,
};
```

### What each piece does

| Export | Role |
|---|---|
| `useTool` hook | Returns `{ execute, cancel, busy, progress }`. Called once per mounted tool. `execute(input)` runs the tool; `cancel()` aborts it. |
| `ProgressCard` | Rendered in the chat while the tool is running. Receives `progress` (a string or null). |
| `ResultCard` | Rendered when the conversation loads a message with this tool's `messageType`. Receives the raw `content` string you saved. |
| `icon` | A [Phosphor Icons](https://phosphoricons.com/) component shown in the tools menu. |

## Step 3: Register the Tool

Add your tool to both registry files.

**`frontend/tools/definitions.ts`** (server-safe):

```typescript
import { myToolDefinition } from "./my-tool/definition";

export const toolDefinitions: ToolDefinition[] = [
  // ...existing definitions
  myToolDefinition,
];
```

**`frontend/tools/registry.ts`** (client-side):

```typescript
import { myTool } from "./my-tool";

export const tools: Tool[] = [
  // ...existing tools
  myTool,
];
```

That's it. Your tool will appear in the tools menu and the agent will be able to invoke it based on the `intentKeywords` you defined.

## Context Available to Tools

Every tool receives a `ToolContext` with:

| Property | Type | Description |
|---|---|---|
| `appId` | `number` | Current app ID |
| `itemId` | `number` | Current work item ID |
| `app` | `App` | Full app object (name, directory, settings) |
| `workItem` | `Task` | Full work item (branch, worktree, preview port, status) |
| `iframeRef` | `RefObject<HTMLIFrameElement>` | Reference to the preview iframe — useful for tools that interact with the running app |
| `proxyBase` | `string` | Base URL for proxying requests to the preview server |
| `saveMessage` | `(content, role, type?) => Promise` | Save a message to the conversation thread |
| `reloadMessages` | `() => Promise` | Refresh the message list after saving |
| `setDiffHighlight` | `(file \| null) => void` | Highlight a file in the diff panel |
| `setForceTab` | `(tab \| null) => void` | Force the side panel to show preview, diff, etc. |

## Helpers

### `ensurePreviewRunning(ctx, onProgress?)`

Import from `../ensurePreview`. Checks if the preview server is running and starts it if needed. Returns `true` when ready, `false` if it could not start. Useful for tools that need the app to be live before they can work.

```typescript
import { ensurePreviewRunning } from "../ensurePreview";

const ready = await ensurePreviewRunning(ctx, setProgress);
if (!ready) {
  // handle failure
  return;
}
```

## Streaming Progress

Most built-in tools use Server-Sent Events (SSE) to stream progress from the backend. The pattern is:

1. Call an API endpoint that returns a streaming response
2. Parse SSE events in a loop (`event: type\ndata: {...}\n\n`)
3. Update `setProgress()` on each progress event
4. Collect the final result and save it via `ctx.saveMessage()`

See the [seed tool](../frontend/tools/seed/index.tsx) for a complete SSE streaming example.

## Tips

- **Keep definitions server-safe.** The `definition.ts` file must not import React or browser APIs — it is used on the server for intent classification.
- **Use `messageType` consistently.** The type you pass to `ctx.saveMessage()` must match the `messageType` in your definition, otherwise the result card won't render when the conversation reloads.
- **Provide clear `intentKeywords`.** The agent uses this text to decide which tool to invoke. Include positive examples ("seed some data", "populate the database") and negative clarifications ("NOT about explaining code") to avoid false matches.
- **Handle errors gracefully.** Save error state in the message content so `ResultCard` can display it. Users will see result cards when they revisit old conversations.
- **Support cancellation.** Wire up an `AbortController` so users can stop long-running tools. Pass the signal to fetch calls or async operations.
