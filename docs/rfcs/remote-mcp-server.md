# RFC: Remote MCP Server For Archie

Status: Draft
Date: 2026-06-19
Branch: TBD

## Summary

Archie should expose a remote Model Context Protocol server so external AI applications can use Archie without opening the Archie UI. The target clients include Claude, Cursor, ChatGPT, and any other MCP-compatible host that can connect to a remote HTTP MCP endpoint.

The remote MCP server should be an external control surface over Archie, not a separate agent runtime. External clients should ask Archie for project-level outcomes:

```text
list apps
list skills
ask a read-only project question
start a task with a skill
continue a task
check task status
start a server or preview
inspect current activity
```

Archie should continue to own worktrees, preflight checks, skill activation, provider selection, run persistence, preview process management, git state, and final task results.

The first version should use bearer token authentication and a durable job model for long-running work. MCP tool calls that start implementation should return quickly with a `run_id`, `conversation_id`, and polling hint. External MCP clients can then call status/result tools to retrieve progress and final output.

## Goals

- Add a remote MCP endpoint that works with external MCP clients.
- Use bearer tokens for authentication in V1.
- Scope tokens by app and capability so external clients only receive the access they need.
- Expose stable Archie-level tools instead of raw shell, arbitrary cwd, or direct filesystem access.
- Support long-running implementation tasks through durable Archie runs and polling.
- Let external clients continue existing tasks by conversation or run identity.
- Let external clients retrieve final task results, changed files, links, preview URLs, and error diagnostics.
- Reuse Archie's existing conversations, work items, runs, sessions, global skills, project skills, app runner, preview runner, and activity tracking.
- Keep the first implementation small enough to validate with real MCP clients before adding OAuth or advanced streaming.

## Non-Goals

- Do not replace Archie's existing UI.
- Do not build a separate agent runtime inside the MCP server.
- Do not expose arbitrary shell execution as an MCP tool.
- Do not expose arbitrary path reads or writes outside Archie-managed apps and worktrees.
- Do not require streaming support from every MCP client for long-running tasks.
- Do not implement OAuth in V1.
- Do not make every existing Next.js API route available through MCP.
- Do not let external clients bypass Archie authorization, preflight, worktree isolation, or audit trails.

## Current Archie Anchors

Archie already has most of the backend primitives required for this:

- `apps` store known projects, ports, directories, and GitHub repo metadata.
- `global_skills` store admin-defined skills available across sessions.
- `.archie/skills` stores repo-local project skills.
- `conversations` and `messages` store task/chat history.
- `work_items` represent executable implementation tasks.
- `work_item_env` stores worktree, branch, preview port, and preview process state.
- `agent_sessions` store provider sessions and external session IDs.
- `runs` store workflow execution status, provider/model, budget, result, failure, and progress fields.
- `streamConversationMessage` already creates or resumes task runs and delegates to the configured provider.
- `startApp`, `startPreview`, and managed process records already start and track servers.
- `getActiveRuns`, conversations, work items, and managed processes can support an activity/status view.

The MCP layer should mostly adapt these primitives into stable tool contracts.

## Transport

The remote MCP server should use MCP Streamable HTTP.

Suggested route:

```text
POST /api/mcp
GET  /api/mcp
```

V1 should implement the minimum needed for broad client compatibility:

- `initialize`
- `tools/list`
- `tools/call`
- `ping`
- HTTP bearer token authentication
- JSON responses for normal calls
- optional SSE response support when a client accepts it

Long-running implementation should not depend on keeping the HTTP request open. The durable polling model should work even if the client disconnects, times out, or does not render streaming tool output well.

## Authentication

V1 uses bearer tokens:

```http
Authorization: Bearer archie_xxx
```

Tokens should be stored hashed in Archie, not plaintext. A token record should include:

```text
id
name
token_hash
created_by_user_id
last_used_at
expires_at
revoked_at
scopes_json
allowed_app_ids_json
created_at
updated_at
```

Suggested scopes:

```text
apps:read
skills:read
project:read
tasks:read
tasks:write
tasks:stop
servers:read
servers:start
servers:stop
activity:read
```

The token must be checked on every MCP request. Tool handlers should also check scope and app access before doing any work.

### Token Management

V1 can expose token management only inside Archie settings for admins:

- create token
- name token
- choose scopes
- choose allowed apps or all apps
- copy token once
- revoke token
- inspect last used time

Future versions can add OAuth for clients that expect a user consent flow. Token auth is enough to validate the core product and is easier to use from developer tools.

## Tool Model

Tools should be intention-shaped. The client should not need to know local paths, Next.js routes, or Archie table details.

### Read Tools

#### `archie_list_apps`

Lists apps visible to the token.

Required scope:

```text
apps:read
```

Output should include:

```text
app_id
name
description
framework
directory_label
default_port
github_repo
```

The output should avoid exposing full local filesystem paths unless the token has an explicit future `paths:read` scope.

#### `archie_get_app`

Returns one app's summary, work item counts, active processes, and current branch/preview highlights.

Required scope:

```text
apps:read
```

#### `archie_list_skills`

Lists global skills and, when `app_id` is provided, project skills.

Required scope:

```text
skills:read
```

Inputs:

```text
app_id?: number
scope?: "global" | "project" | "all"
enabled_only?: boolean
```

Output should include skill summaries only:

```text
slug_or_filename
name
description
scope
enabled
trigger_phrases
```

V1 should not return full global skill bodies through MCP. Full skill bodies may contain internal policy or operational detail that should not be exported by default.

#### `archie_ask_project`

Answers a project question using read-only codebase access.

Required scopes:

```text
apps:read
project:read
```

Inputs:

```text
app_id: number
question: string
model?: string
provider?: string
```

Behavior:

- Use Archie's provider `ephemeralQuery` or an equivalent read-only codebase workflow.
- Force read-only tool policy.
- Return an answer with cited files when possible.
- Do not create a work item or worktree.
- Do not mutate files, git state, env, or processes.

#### `archie_list_tasks`

Lists recent or active task conversations for an app.

Required scope:

```text
tasks:read
```

Inputs:

```text
app_id: number
status?: "open" | "archived" | "running" | "completed" | "failed" | "all"
limit?: number
```

Output should include:

```text
task_id
conversation_id
title
status
latest_run_status
branch_name
preview_url
updated_at
```

#### `archie_get_task_status`

Returns the current state of a task or run.

Required scope:

```text
tasks:read
```

Inputs:

```text
run_id?: number
conversation_id?: number
task_id?: number
include_messages?: boolean
include_activity?: boolean
```

At least one identifier is required.

Running output:

```json
{
  "status": "running",
  "run_id": 314,
  "conversation_id": 99,
  "task_id": 42,
  "progress": "Running typecheck",
  "activity": [
    "Edited frontend/lib/server/mcp/handlers.ts",
    "Running npm run typecheck"
  ],
  "next_poll_after_seconds": 10
}
```

Completed output:

```json
{
  "status": "completed",
  "run_id": 314,
  "conversation_id": 99,
  "task_id": 42,
  "final_response": "Implemented the MCP token auth and task tools.",
  "files_changed": [
    "frontend/app/api/mcp/route.ts",
    "frontend/lib/server/mcp/handlers.ts"
  ],
  "preview_url": "https://archie.example.com/api/p/9031",
  "pr_url": null
}
```

Failed output:

```json
{
  "status": "failed",
  "run_id": 314,
  "conversation_id": 99,
  "task_id": 42,
  "error": "Provider unavailable",
  "failure_category": "provider_unavailable",
  "can_continue": true
}
```

#### `archie_get_task_result`

Returns the final result for a completed task, without progress noise.

Required scope:

```text
tasks:read
```

Inputs:

```text
run_id?: number
conversation_id?: number
task_id?: number
```

If the task is not complete, return `status: "running"` or `status: "failed"` and a short hint to call `archie_get_task_status`.

#### `archie_list_activity`

Answers "who is doing what" across the token's visible apps.

Required scope:

```text
activity:read
```

Inputs:

```text
app_id?: number
include_completed_since_minutes?: number
```

Output should join:

- active durable runs
- active conversations
- active work items
- active managed processes
- recent failures
- recent completed tasks if requested

### Action Tools

#### `archie_start_task`

Starts an implementation task in Archie and returns immediately.

Required scopes:

```text
tasks:write
```

Inputs:

```text
app_id: number
prompt: string
title?: string
skill_slug?: string
provider?: string
model?: string
wait_seconds?: number
```

Behavior:

- Create a task conversation and work item, or route to an explicit existing task if a future input supports that.
- If `skill_slug` is provided, validate that the global skill exists and is enabled.
- Prefix the task message with the skill invocation or pass the explicit skill into the prompt assembly path.
- Start Archie's normal task execution path.
- Return `running` quickly with a durable `run_id`.
- If `wait_seconds` is provided, wait up to that duration for a quick completion before returning.

Initial response:

```json
{
  "status": "running",
  "app_id": 1,
  "task_id": 42,
  "conversation_id": 99,
  "run_id": 314,
  "next_poll_after_seconds": 5,
  "status_hint": "Call archie_get_task_status with run_id=314."
}
```

If the task completes within `wait_seconds`, the tool may return the completed result shape directly.

#### `archie_continue_task`

Sends a follow-up instruction to an existing task conversation.

Required scopes:

```text
tasks:write
```

Inputs:

```text
conversation_id: number
prompt: string
provider?: string
model?: string
wait_seconds?: number
```

Behavior:

- Reuse the existing Archie conversation and provider session when available.
- Preserve normal prompt context, prior messages, worktree, and skill behavior.
- Return a new `run_id` if a new run starts.

#### `archie_stop_task`

Stops an active task run.

Required scope:

```text
tasks:stop
```

Inputs:

```text
conversation_id?: number
run_id?: number
```

V1 can require `conversation_id` if the current stop mechanism is conversation-scoped.

#### `archie_start_server`

Starts the main app server.

Required scope:

```text
servers:start
```

Inputs:

```text
app_id: number
```

Output:

```text
status
port
url
message
```

The public URL should use Archie's proxy URL when available, not `0.0.0.0`.

#### `archie_start_preview`

Starts a work item preview server.

Required scope:

```text
servers:start
```

Inputs:

```text
app_id: number
task_id: number
```

Output:

```text
status
port
url
healthy
status_code
```

#### `archie_stop_server`

Stops a main app server or preview.

Required scope:

```text
servers:stop
```

Inputs:

```text
app_id: number
task_id?: number
kind?: "app" | "preview"
```

## Long-Running Task Contract

Long-running tasks are the most important design constraint.

MCP clients vary in how they handle long-running tool calls and streaming tool output. Some clients may time out, disconnect, or not present progress clearly. Archie should therefore treat implementation as a durable job.

### Required Behavior

`archie_start_task` and `archie_continue_task` should:

1. Persist the user request as an Archie message.
2. Start the normal conversation stream in the background.
3. Create a durable `runs` row.
4. Return quickly with `run_id`, `conversation_id`, and `task_id`.
5. Keep running even if the MCP HTTP request disconnects.
6. Persist progress, assistant messages, failure state, and result.
7. Let clients retrieve state through `archie_get_task_status`.

V1 assumes Archie is running as a long-lived Node process, which matches the
local/self-hosted app runtime. The background runner should not depend on the
MCP HTTP response staying open, but it is still process-local. A serverless
deployment that can freeze or terminate work after a response needs an external
worker or durable queue before enabling write tools.

### Polling

The MCP client is responsible for polling by calling `archie_get_task_status`.

Archie should help by returning:

```text
next_poll_after_seconds
status_hint
run_id
conversation_id
task_id
```

Suggested polling cadence:

```text
0-1 minute: every 5 seconds
1-5 minutes: every 10 seconds
5+ minutes: every 30 seconds
```

Archie should not require clients to follow this exactly.

### Optional Wait

For quick tasks, action tools can accept:

```text
wait_seconds
```

If the task finishes inside that window, return the final result directly. Otherwise return the running shape.

Suggested limits:

```text
default: 0
maximum: 30
```

### Progress Storage

V1 should use existing data first:

- `runs.status`
- `runs.progress_text`
- `runs.error_text`
- `runs.failure_category`
- `runs.result_json`
- latest assistant/user/system messages
- provider activity events when already persisted
- worktree env and preview status

If current activity events are not durable enough, add an `mcp_run_events` or general `run_events` table later:

```text
id
run_id
kind
message
payload_json
created_at
```

This table would make `archie_get_task_status(include_activity: true)` reliable across process restarts.

## Background Execution

Current `streamConversationMessage` returns a `ReadableStream` intended for an HTTP response. The MCP implementation uses a service-level API that can consume this stream internally and persist the final state without tying execution to the MCP request lifecycle.

Implemented extraction:

```text
frontend/lib/server/conversation-runner.ts
```

Responsibilities:

- start a conversation run for a long-lived Archie server process
- consume provider/conversation stream events
- persist messages and run status
- expose run identity immediately
- support cancellation
- support optional `wait_seconds`

The MCP handler uses this service for remote task tools. The existing Next.js
streaming route can move to the same service later if we want one shared
conversation execution entrypoint for UI-driven and MCP-driven tasks.

## Response Shape

All tool results should include both readable text and structured content when possible. The structured content is important for clients that can parse MCP tool output.

Example tool result content:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Task 42 is running. Call archie_get_task_status with run_id=314."
    }
  ],
  "structuredContent": {
    "status": "running",
    "run_id": 314,
    "conversation_id": 99,
    "task_id": 42,
    "next_poll_after_seconds": 5
  },
  "isError": false
}
```

## Audit And Safety

Remote MCP tools can trigger code changes and local server processes, so every MCP tool call should be auditable.

Add an audit table:

```text
mcp_audit_events
id
token_id
app_id
tool_name
input_summary_json
result_summary_json
status
error_text
created_at
duration_ms
```

Audit logs should avoid storing full prompts by default if they may contain secrets. Store enough metadata to debug and review usage.

Safety rules:

- Validate every input with schemas.
- Check token scope and app access inside each handler.
- Rate limit by token.
- Redact tokens and secrets from logs.
- Do not return full local paths by default.
- Prefer proxy URLs over raw local bind addresses.
- Mark mutating tools clearly in tool descriptions.
- Keep read-only project Q&A on a read-only tool policy.
- Do not allow disabled skills to be invoked.
- Do not let MCP clients write files in generic conversation mode.

## Proposed File Layout

```text
frontend/app/api/mcp/route.ts
frontend/lib/server/mcp/auth.ts
frontend/lib/server/mcp/errors.ts
frontend/lib/server/mcp/protocol.ts
frontend/lib/server/mcp/registry.ts
frontend/lib/server/mcp/handlers.ts
frontend/lib/server/mcp/schemas.ts
frontend/lib/server/mcp/audit.ts
frontend/lib/server/mcp/tokens.ts
frontend/lib/server/conversation-runner.ts
frontend/__tests__/unit/mcp-auth.test.ts
frontend/__tests__/unit/mcp-tools.test.ts
frontend/__tests__/integration/mcp-route.test.ts
```

The MCP protocol layer should stay thin. Business logic should live in handlers and reusable Archie services.

## Implementation Plan

### Phase 1: Read-Only Remote MCP

- Add token storage and bearer token validation.
- Add `/api/mcp` with `initialize`, `tools/list`, `tools/call`, and `ping`.
- Add `archie_list_apps`.
- Add `archie_list_skills`.
- Add `archie_ask_project` with read-only policy.
- Add unit/integration tests for auth, tool listing, and basic calls.

### Phase 2: Durable Task Tools

- Extract or add a background conversation-runner service.
- Add `archie_start_task`.
- Add `archie_continue_task`.
- Add `archie_get_task_status`.
- Add `archie_get_task_result`.
- Add `archie_stop_task`.
- Persist enough progress to make polling useful.

### Phase 3: Servers And Activity

- Add `archie_start_server`.
- Add `archie_start_preview`.
- Add `archie_stop_server`.
- Add `archie_list_activity`.
- Normalize returned URLs through Archie's proxy behavior.

### Phase 4: Hardening

- Add rate limits.
- Add audit UI.
- Add token last-used metadata.
- Add optional run events table.
- Add optional SSE progress for clients that support it well.
- Revisit OAuth if ChatGPT or enterprise clients require user-level consent instead of static tokens.

## Open Questions

- Should tokens be installation-wide admin tokens only in V1, or can members create app-scoped personal tokens?
- Should `archie_ask_project` create a lightweight conversation record for auditability, or stay ephemeral with only MCP audit logs?
- Should full skill bodies ever be exposed through MCP, or only names/descriptions?
- Should `archie_start_task` always create a new work item, or support `conversation_id` in V1?
- How should Archie present MCP-started tasks in the UI timeline and sidebar?
- What is the preferred public URL base for server/preview links in self-hosted deployments?
- Do we need per-client token presets for ChatGPT, Claude, Cursor, and internal tools?

## References

- Model Context Protocol Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- Model Context Protocol tools: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Model Context Protocol authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- OpenAI remote MCP guidance: https://platform.openai.com/docs/mcp
