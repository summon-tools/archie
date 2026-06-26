# RFC: Home Rooms And Coordinator-Led Plan Execution

Status: Draft  
Date: 2026-05-11  
Branch: `feature/task-plan-mode`

## Summary

Archie currently centers on task conversations: a user starts a conversation, Archie creates a work item, and execution happens inside a dedicated worktree with preview, diff, git, and PR controls. That flow should remain unchanged.

This RFC proposes a separate project-level Home surface for planning, multi-agent discussion, and step-by-step execution orchestration. Home introduces Rooms: persistent planning and coordination spaces where a fixed default team of agents can discuss a large change, produce a structured plan, and execute that plan through the existing task conversation system.

The central design choice is that plan execution is deterministic and implemented in Archie code. Agents can analyze, implement, review, and summarize, but they do not decide the workflow order. The product owns the execution state machine:

```text
plan -> implement step -> review -> security review -> QA -> fix if needed -> commit -> next step
```

The Coordinator agent drives the conversation and writes progress updates, but the backend enforces the phases, gates, persistence, and transitions.

## Goals

- Preserve the current task conversation and worktree flow as-is.
- Add a new Home area for project-level planning and orchestration.
- Introduce Rooms as multi-agent planning spaces that do not create worktrees by default.
- Use a fixed default agent team in V1.
- Allow planning agents to inspect the codebase using read-only tools.
- Represent plans as structured executable artifacts, not only markdown chat history.
- Execute plans one scoped step at a time through normal work item conversations.
- Run review, security, architecture, and QA gates after implementation steps.
- Let the user leave and come back to see durable plan progress.
- Avoid dumping a large plan into one agent request.

## Non-Goals

- Do not replace current conversations, work items, preview, branch, or PR flows.
- Do not add user-created agents in V1.
- Do not expose agent name, prompt, or model customization in V1.
- Do not let agents freely choose or skip execution phases.
- Do not let plan mode write files directly.
- Do not claim hardened multi-tenant security boundaries.
- Do not require every plan step to have the same agent sequence if Archie can encode conditional rules safely.

## Current System Constraints

The current application has useful pieces we should reuse:

- `work_items` represent executable tasks.
- `conversations` store task threads and messages.
- `runs` can already point to a `conversation_id` and have nullable `work_item_id`.
- `agent_sessions` are conversation-scoped.
- `streamConversationMessage` creates worktrees lazily for task conversations.
- `ConversationView`, `PreviewPanel`, branch controls, and tools assume a work item context.

Those assumptions are good for task execution. They are not the right abstraction for planning rooms. Home should be additive rather than invasive.

## Product Model

### Existing Conversation Flow

The existing path remains the task lane:

```text
New conversation -> work item -> worktree -> implementation -> preview/diff/git/PR
```

This is still where code changes happen.

### Home

Home is the project-level coordination surface.

Suggested route:

```text
/apps/:appId/home
```

Home has two primary areas:

- Conversations: links to the existing task conversation/work item flow.
- Rooms: planning and orchestration spaces.

Home answers: "What should we do?"

Existing conversations answer: "Do this task."

### Room

A room is a persistent planning/control space.

It does not automatically create:

- worktree
- preview
- branch
- PR

The room contains:

- human discussion
- agent discussion
- a structured plan artifact
- execution progress
- links to generated task conversations
- decisions and blockers

Suggested room layout:

```text
+----------------+------------------------------+----------------------+
| Rooms sidebar  | Room timeline / chat          | Plan / execution     |
|                |                              | panel                |
| Planning       | Human and agent messages      | Current plan         |
| Architecture   | Run progress events           | Step statuses        |
| Release Prep   | Decisions and blockers        | Linked tasks         |
|                |                              | Agent team           |
+----------------+------------------------------+----------------------+
```

The right panel should start with the plan. Agent/team details can be visible but not configurable in V1.

## Default Agent Team

V1 ships with a fixed product-defined agent team. Users can use these agents in planning discussion and the execution pipeline, but cannot customize or add agents yet.

### Coordinator

Owns orchestration.

Responsibilities:

- keeps the room timeline updated
- turns discussion into structured plan changes
- starts plan execution
- creates or reuses task conversations for plan steps
- sends scoped implementation briefs
- requests review/security/QA/architecture checks
- summarizes feedback into actionable fix requests
- advances the execution state machine when gates pass
- pauses and asks the user when blocked

The Coordinator should not write code directly in V1.

### Planner / Architect

Responsibilities:

- analyzes system design
- identifies dependencies and ordering
- flags architecture risks
- helps convert broad goals into executable steps
- participates in architecture review during execution when needed

### Implementer

Responsibilities:

- implements code changes inside normal task conversations
- works in worktrees created by the existing task system
- receives only the current step brief and relevant prior context
- avoids implementing future steps unless instructed

### Reviewer

Responsibilities:

- reviews diffs and behavior
- checks for bugs, regressions, and missing tests
- produces structured findings
- recommends whether the step can proceed

### QA

Responsibilities:

- validates acceptance criteria
- recommends or runs tests where allowed
- records validation notes

### Security

Responsibilities:

- reviews auth, authorization, session handling, data exposure, secrets, unsafe execution, dependency risks, injection risks, and permission boundaries
- participates in planning when security-sensitive work is being designed
- participates in execution gates before commit when a step touches sensitive areas

## Agent Use By Phase

The same fixed agents can participate in planning and execution, but their tool policies differ.

### Planning Phase

Allowed:

- read repo files
- search files
- inspect skills, codebase index, routes, migrations, configuration
- ask questions
- propose plan steps
- critique plans

Blocked:

- file writes
- destructive shell commands
- worktree creation
- commits
- pushes
- PR creation
- preview mutations unless explicitly introduced later

Planning mode must not run with `tools: []` as the default because that would prevent useful code inspection. It should run with read-only repository tools.

### Execution Phase

The Implementer receives write/worktree capabilities through the existing task lane.

Reviewer, Architect, QA, and Security should default to read-only or validation-only capabilities:

- read repo
- inspect diff
- inspect test output
- run approved validation commands if supported by policy
- no direct file writes

The Coordinator should use orchestration actions, not raw repository mutation.

## Tool Policy

Tool policy should be explicit and stored per room run or execution run.

Example policy shape:

```ts
type ToolPolicy = {
  readRepo: boolean;
  writeRepo: boolean;
  shell: "none" | "read_only" | "validation" | "full";
  browser: "none" | "inspect" | "interact";
  git: "none" | "status" | "commit" | "push";
  network: boolean;
};
```

V1 suggested policies:

```text
planning_agent:
  readRepo: true
  writeRepo: false
  shell: read_only
  browser: none
  git: status
  network: false

implementer:
  readRepo: true
  writeRepo: true
  shell: full
  browser: interact
  git: status
  network: false

reviewer:
  readRepo: true
  writeRepo: false
  shell: validation
  browser: none
  git: status
  network: false

security:
  readRepo: true
  writeRepo: false
  shell: validation
  browser: none
  git: status
  network: false

coordinator:
  readRepo: true
  writeRepo: false
  shell: none
  browser: none
  git: none
  network: false
  orchestrationActions: true
```

Provider adapters need to honor these policies. For Claude, this likely maps to allowed/disallowed tools and permission mode. For Codex, this may require adding a safer non-`--full-auto` mode or initially limiting Codex usage to implementation lanes where a worktree exists.

## Structured Plan Model

The room discussion is not enough. Archie needs a structured plan artifact that the execution engine can run.

Proposed tables:

```sql
CREATE TABLE home_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  purpose TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open', 'archived')),
  created_by INTEGER DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE TABLE room_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  author_user_id INTEGER DEFAULT NULL,
  agent_key TEXT DEFAULT NULL,
  role TEXT NOT NULL
    CHECK(role IN ('user', 'agent', 'system')),
  kind TEXT NOT NULL DEFAULT 'message'
    CHECK(kind IN ('message', 'decision', 'plan_update', 'execution_event', 'error')),
  body_md TEXT NOT NULL DEFAULT '',
  payload_json TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (room_id) REFERENCES home_rooms(id) ON DELETE CASCADE
);

CREATE TABLE room_agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  agent_key TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT DEFAULT NULL,
  phase TEXT NOT NULL
    CHECK(phase IN ('planning', 'critique', 'coordination', 'review', 'security', 'qa')),
  tool_policy_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running', 'completed', 'failed', 'stopped')),
  input_json TEXT DEFAULT NULL,
  result_json TEXT DEFAULT NULL,
  error_text TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (room_id) REFERENCES home_rooms(id) ON DELETE CASCADE
);

CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary_md TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft', 'ready', 'executing', 'completed', 'blocked', 'cancelled')),
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (room_id) REFERENCES home_rooms(id) ON DELETE CASCADE
);

CREATE TABLE plan_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective_md TEXT NOT NULL DEFAULT '',
  implementation_prompt_md TEXT NOT NULL DEFAULT '',
  acceptance_criteria_md TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'medium'
    CHECK(risk_level IN ('low', 'medium', 'high')),
  requires_architecture_review INTEGER NOT NULL DEFAULT 0,
  requires_security_review INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'implementing', 'reviewing', 'fixing', 'validating', 'committing', 'completed', 'blocked', 'failed', 'skipped')),
  linked_work_item_id INTEGER DEFAULT NULL,
  linked_conversation_id INTEGER DEFAULT NULL,
  base_commit_sha TEXT DEFAULT NULL,
  commit_sha TEXT DEFAULT NULL,
  result_summary_md TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_work_item_id) REFERENCES work_items(id),
  FOREIGN KEY (linked_conversation_id) REFERENCES conversations(id)
);

CREATE TABLE plan_step_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_step_id INTEGER NOT NULL,
  phase TEXT NOT NULL,
  agent_key TEXT DEFAULT NULL,
  status TEXT NOT NULL,
  summary_md TEXT DEFAULT '',
  payload_json TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (plan_step_id) REFERENCES plan_steps(id) ON DELETE CASCADE
);
```

The existing `runs` table can also be extended later with `room_id`, `plan_id`, `plan_step_id`, and `agent_key`. V1 can use `room_agent_runs` and `plan_step_events` if that is lower risk.

## Execution Flow

Execution is implemented by Archie as a durable state machine.

### High-Level Flow

```text
User clicks Execute Plan
  -> Coordinator selects next pending step
  -> Archie creates a normal work item conversation for that step
  -> Implementer runs inside that task conversation
  -> Archie waits for task completion
  -> Reviewer reviews the result
  -> Security reviews if required or if sensitive files changed
  -> Architect reviews if required or if architectural risk is high
  -> QA validates acceptance criteria
  -> Coordinator summarizes feedback
  -> If changes requested: send scoped fix message to task conversation
  -> If approved: commit step
  -> Advance to next step
```

### Deterministic Step State Machine

```text
pending
  -> implementing
  -> reviewing
  -> fixing
  -> reviewing
  -> validating
  -> committing
  -> completed

Any phase can transition to:
  -> blocked
  -> failed
  -> skipped
```

Suggested phase rules:

```text
pending -> implementing
  Create work item and send implementation packet.

implementing -> reviewing
  Triggered when task conversation reaches completed status.

reviewing -> fixing
  If Reviewer, Security, Architect, or QA returns blocking findings.

fixing -> reviewing
  Triggered when the implementation task completes the fix request.

reviewing -> validating
  If all required review agents approve or return non-blocking notes.

validating -> committing
  If tests and acceptance validation pass.

committing -> completed
  Commit succeeds and commit SHA is recorded.

any -> blocked
  The coordinator needs user input, conflicts are unresolved, validation cannot proceed, or repeated fix attempts fail.
```

### Bounded Fix Loop

The engine should enforce a max number of fix loops per step.

Suggested V1 default:

```text
max_fix_attempts_per_step = 2
```

After that, the step becomes `blocked` and the room asks the user how to proceed.

## Implementation Packet

The Implementer should not receive the full plan every time. Each step gets a scoped packet.

Example:

```text
Project goal:
<short goal from plan>

Current step:
<step title>

Objective:
<step objective>

Implementation instructions:
<implementation_prompt_md>

Acceptance criteria:
<acceptance_criteria_md>

Completed prior steps:
- <step title>: <summary and commit sha>

Constraints and decisions:
- <decision extracted from room>

Important:
- Implement only this step.
- Do not implement future steps.
- Preserve existing behavior outside this step.
```

This packet becomes the first message in the generated task conversation.

## Review Outputs

Review agents should return structured results so the Coordinator and engine can make durable decisions.

Suggested schema:

```json
{
  "status": "approved",
  "summary": "The step satisfies the requested behavior.",
  "findings": [],
  "validation": {
    "tests_reviewed": [],
    "manual_checks": []
  }
}
```

When changes are requested:

```json
{
  "status": "changes_requested",
  "summary": "The implementation misses the empty-state behavior.",
  "findings": [
    {
      "severity": "high",
      "category": "bug",
      "file": "frontend/components/Example.tsx",
      "line": 42,
      "issue": "The component assumes data is always present.",
      "recommendation": "Handle empty arrays before rendering the list."
    }
  ]
}
```

`status` values:

```text
approved
approved_with_notes
changes_requested
blocked
failed
```

Only `approved` and `approved_with_notes` allow the next gate.

## Coordinator Behavior

The Coordinator is agentic in interpretation but bounded in authority.

It can:

- summarize room discussion
- update the plan artifact through controlled APIs
- decide whether review findings are blocking when the reviewer marks them non-blocking
- draft fix requests
- explain progress to the user
- ask for user input when blocked

It cannot:

- skip required engine phases
- mark a required review as passed without a review result
- commit directly without the commit phase
- write files directly
- silently continue after repeated failures
- execute future steps early

The Coordinator posts room timeline updates like:

```text
Step 2 is in implementation.
Reviewer requested changes around auth edge cases.
I sent the fix request back to the implementation conversation.
Security approved after the fix.
QA approved the step validation.
Committed step 2 as abc123.
Starting step 3.
```

## Security Review Rules

Security review should always run when:

- a step touches auth/session code
- a step touches authorization or roles
- a step touches secrets, env vars, tokens, provider credentials, or CLI auth
- a step changes shell execution, tool permissions, worktrees, or process management
- a step changes API routes that expose data
- a step changes dependency installation or package execution
- the Coordinator or Reviewer flags security risk

For low-risk UI-only steps, Security can be optional in V1, but the plan step should record why it was skipped.

## Commit Policy

Commits should be created by the execution engine after gates pass, not by the Implementer directly.

Suggested V1 rules:

- one commit per completed plan step
- commit message derived from the step title
- commit body includes plan id, step id, and validation summary
- commit SHA is stored on `plan_steps.commit_sha`
- if no file changes exist, skip commit and mark the step completed with a no-op note

The existing branch/push/PR flow can remain user-driven at first. Later versions can add plan-level PR creation.

## UI Details

### Home Page

Home should be the first project-level coordination view.

Suggested route:

```text
/apps/:appId/home
```

Primary navigation:

- Conversations
- Rooms

### Rooms List

The room sidebar shows:

- room title
- current plan status
- active execution indicator
- blocked indicator
- last activity time

V1 room creation can be simple:

- title
- purpose
- optional seed message

### Room Timeline

Timeline message types:

- user message
- agent message
- system event
- decision
- plan update
- execution event
- blocker

Agent messages should show which fixed agent produced them.

### Plan Panel

The plan panel should show:

- plan title
- summary
- step list
- per-step status
- linked task conversation
- review/security/QA status
- commit SHA
- blocker reason

Actions:

- `Update plan`
- `Execute plan`
- `Pause execution`
- `Resume execution`
- `Open task conversation`

### Agent Panel

V1 should show the default team but not allow edits.

For each agent:

- name
- short role description
- model/provider
- current status

This keeps the system understandable without turning the first version into an agent configuration product.

## API Surface

Suggested room APIs:

```text
GET    /api/apps/:appId/home
GET    /api/apps/:appId/rooms
POST   /api/apps/:appId/rooms
GET    /api/apps/:appId/rooms/:roomId
PATCH  /api/apps/:appId/rooms/:roomId
GET    /api/apps/:appId/rooms/:roomId/messages
POST   /api/apps/:appId/rooms/:roomId/messages
POST   /api/apps/:appId/rooms/:roomId/agents/:agentKey/run
GET    /api/apps/:appId/rooms/:roomId/events
```

Suggested plan APIs:

```text
GET    /api/apps/:appId/rooms/:roomId/plan
POST   /api/apps/:appId/rooms/:roomId/plan
PATCH  /api/apps/:appId/rooms/:roomId/plan
POST   /api/apps/:appId/rooms/:roomId/plan/execute
POST   /api/apps/:appId/rooms/:roomId/plan/pause
POST   /api/apps/:appId/rooms/:roomId/plan/resume
POST   /api/apps/:appId/rooms/:roomId/plan/steps/:stepId/retry
POST   /api/apps/:appId/rooms/:roomId/plan/steps/:stepId/skip
```

Suggested internal orchestration actions:

```text
create_task_for_step
send_message_to_task_conversation
run_review_agent
run_security_agent
run_architecture_agent
run_qa_agent
create_step_commit
advance_step
block_step
pause_plan
resume_plan
```

These should be backend-controlled actions, not raw agent tools.

## Event Model

Room execution needs durable events and live updates.

SSE can mirror the conversation event pattern:

```text
event: message
event: plan_update
event: step_status
event: agent_run
event: blocker
event: done
event: error
```

The UI should reconstruct state from the database, not rely on in-memory event history.

## Background Execution

Plan execution should not depend on the user keeping the browser open.

V1 can start with server-side async jobs in the same process if that matches the current architecture, but the state machine should be durable enough to later move to a real queue.

Required persistence:

- active plan execution
- active step
- current phase
- linked work item/conversation
- active run ids
- fix attempt count
- blocker reason

## Failure And Blocker Handling

Execution should pause when:

- worktree creation fails
- implementation task fails repeatedly
- review agent cannot run
- security review returns blocking risk
- validation fails repeatedly
- git commit fails
- merge conflicts appear
- the Coordinator needs product clarification

A blocked room should show:

- current step
- blocking phase
- reason
- recommended next actions
- transcript links
- retry/skip/cancel controls

## Phased Implementation Plan

### Phase 1: Home And Room Skeleton

- Add Home route.
- Add room list and room detail layout.
- Add room tables and DAL.
- Add room messages and SSE.
- Add fixed default agent metadata.
- Allow user to chat in a room.

No plan execution yet.

### Phase 2: Read-Only Agent Runs In Rooms

- Add room agent run API.
- Add read-only tool policy.
- Allow invoking fixed agents during planning.
- Store agent messages and run metadata.
- Prevent writes during room planning.

### Phase 3: Structured Plan Artifact

- Add `plans` and `plan_steps`.
- Add plan panel.
- Add Coordinator-assisted plan updates.
- Add plan readiness validation.

### Phase 4: Execute First Step Through Existing Task Flow

- Add `Execute plan`.
- Create a normal work item/conversation for the first step.
- Send scoped implementation packet.
- Link `plan_steps` to the created work item and conversation.
- Reflect task status back into the room.

### Phase 5: Deterministic Review Gates

- Run Reviewer after implementation completes.
- Run Security when required.
- Run Architect when required.
- Run QA validation.
- Convert blocking feedback into fix messages.
- Enforce fix attempt limit.

### Phase 6: Commit And Advance

- Create one commit per accepted step.
- Store commit SHA and validation summary.
- Advance to next step.
- Continue until complete or blocked.

### Phase 7: Plan-Level Polish

- Plan progress dashboard.
- Better room notifications.
- Plan-level PR creation.
- Resume after server restart.
- More robust provider policy enforcement.

## Open Questions

- What provider/tool mechanisms are available for true read-only Claude planning runs?
- Should Codex be available in planning rooms before a read-only Codex mode exists?
- Should every step always run Security, or should Security be risk-triggered with recorded skip reasons?
- Should commits happen per step by default, or should users choose between per-step and final squash?
- Should execution create one long task conversation for all steps or one task conversation per step? This RFC recommends one task conversation per step for clearer boundaries.
- Should Home become the default route after opening a project, or should it live beside the current conversation default until adoption is proven?
- How should plan execution resume after process restart if an underlying provider run was active?

## Recommendation

Build Home and Rooms as a new layer above the existing conversation system.

Do not alter the current task conversation path in V1. Use it as the worker lane for implementation. Let Rooms own planning, coordination, structured plans, and execution progress.

The most important implementation principle is that the execution flow belongs to Archie code. Agents can provide intelligence inside each phase, but the backend owns the state machine, phase transitions, gates, persistence, and safety boundaries.
