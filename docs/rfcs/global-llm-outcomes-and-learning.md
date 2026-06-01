# RFC: Global LLM Outcomes And Team Learning

Status: Draft  
Date: 2026-06-01  
Branch: `feature/session-analysis`

## Summary

Archie should add a global outcomes dashboard that analyzes LLM-assisted engineering work across the whole installation, not only inside one app. The dashboard should answer:

```text
Which LLM-assisted sessions produced durable engineering outcomes, what did those sessions have in common, and what should the team learn from them?
```

This is not a productivity or employee-ranking tool. It is a learning system for teams using Archie: it connects local session evidence, run cost, pull request lifecycle, GitHub review evidence, commit attribution, CI results, and follow-up fixes so teams can see which LLM workflows actually helped them ship better code.

The first version should be evidence-first. Open pull requests are still work in progress, so Archie should show them as live pipeline evidence, not final learning material. Durable insights should come from resolved work: merged PRs, closed PRs, reverted PRs, and PRs or issues that later fix regressions introduced by earlier work.

## Goals

- Create one global dashboard for all apps in an Archie installation.
- Allow filters and drilldowns by app, repository, developer, agent provider, model, outcome band, and time range.
- Measure cost against outcomes: total LLM spend, spend tied to merged PRs, spend tied to pending PRs, spend tied to closed-unmerged work, spend tied to follow-up fixes, and spend with no PR evidence.
- Treat open PRs as pending evidence, not final judgment.
- Add GitHub evidence collection for PR lifecycle, reviews, comments, commits, checks, labels, and follow-up signals.
- Attribute commits to humans, Archie-managed agents, and co-authored human-agent work where evidence supports it.
- Detect correction work after the initial LLM session, including human-only commits, agent commits, review-driven commits, and CI-driven commits.
- Detect likely regressions or follow-up fixes related to prior LLM-assisted PRs.
- Generate team-specific learning reports grounded in concrete PRs, commits, comments, checks, and session evidence.
- Keep the default product experience pattern-first rather than person-first.

## Non-Goals

- Do not build a generic engineering productivity dashboard.
- Do not rank developers by output, cost, merge rate, or agent usage.
- Do not make final claims about open PRs.
- Do not block PRs or become a required code-review gate.
- Do not require perfect regression attribution in V1.
- Do not require token accounting to be complete before delivering value.
- Do not replace GitHub review, CI, or project management workflows.
- Do not expose raw sensitive code/comment data in shared reports without deliberate product controls.

## Current Archie Anchors

Archie already has useful local data to join against GitHub evidence:

- `apps` identify projects and GitHub repositories.
- `work_items` represent executable tasks.
- `conversations` and `messages` store user prompts, agent responses, and correction loops.
- `agent_sessions` store provider sessions and external session IDs.
- `runs` store provider, model, status, timing, cost, turns, and failure state.
- `artifacts` store generated outputs, including `pull_request` metadata.
- GitHub OAuth/App settings already exist.
- Work item PR status lookup already exists for individual PRs.
- Archie can co-author commits with configured GitHub bot identity.

The missing layer is durable GitHub evidence storage and global analysis.

## Product Model

### Global Outcomes Dashboard

Suggested route:

```text
/outcomes
```

The dashboard is global by default. It should aggregate all apps and repositories known to the installation.

Primary sections:

- Outcome summary
- Cost by outcome
- Pending PR pipeline
- Resolved work analysis
- Review and correction burden
- Follow-up fix and regression signals
- Learning report
- Evidence explorer

Project/app-specific detail should exist as filters or drilldowns, not as the primary dashboard model.

### Open Work Is Pipeline Evidence

Open PRs are useful, but not final.

For open PRs Archie can show:

- PR age
- current CI state
- review count
- requested changes
- unresolved threads
- human commits after agent work
- agent commits after review
- current LLM cost tied to the work

Archie should not use open PRs to produce final "this worked" or "this failed" learning.

### Resolved Work Is Learning Material

Archie can produce stronger conclusions when a PR is:

- merged
- closed unmerged
- reverted
- superseded
- followed by a later fix or regression PR

Resolved work should feed the learning report because the lifecycle has produced enough evidence to judge the outcome.

### Pattern-First, Not Leaderboard-First

The dashboard should help the team answer:

- What LLM workflows led to merged, low-churn PRs?
- What review patterns showed that the LLM output needed human correction?
- Which prompt and validation habits show up in strong sessions?
- Which file areas, task types, or app contexts produce repeated rework?
- Which examples should be shared so everyone can use the LLM better?

It should avoid default views like:

- "best developer"
- "worst developer"
- "developer productivity score"

Developer filters can still exist for self-review and evidence exploration, but the shared report should emphasize team practices and concrete examples.

## Outcome States

Each LLM-assisted work item should have an outcome state.

```text
unknown
no_pr
pending_pr
merged
closed_unmerged
reverted
follow_up_fix_detected
likely_regression
superseded
```

The state is evidence-derived and can change over time. For example, a merged PR can later become `follow_up_fix_detected` if a later PR references it or changes the same behavior to fix a bug.

## Quality Bands

Quality bands should be ordinal, explainable, and confidence-labeled.

Suggested bands:

```text
unknown
pending
abandoned
costly_reworked
useful
strong
```

Example mapping:

- `pending`: PR is open or work is still active.
- `abandoned`: session ended with no PR and no later evidence of accepted work.
- `costly_reworked`: closed unmerged, reverted, required heavy human correction, or later fix/regression evidence exists.
- `useful`: merged with acceptable review and CI evidence.
- `strong`: merged with low review churn, passing CI, limited correction commits, and no follow-up fix signals during the observation window.
- `unknown`: evidence is incomplete.

Every band must include:

- evidence summary
- confidence label
- links to sessions, PRs, commits, checks, and comments

## Cost Model

Archie should compute cost from local `runs.result_json.cost` where available.

Global cost buckets:

```text
total_llm_cost
merged_pr_cost
pending_pr_cost
closed_unmerged_cost
reverted_or_follow_up_fix_cost
no_pr_cost
unknown_outcome_cost
```

This allows reports like:

```text
Total LLM spend: $100
Merged PR spend: $20
Pending PR spend: $35
Closed-unmerged spend: $15
No-PR or unknown spend: $30
```

The first version should be honest about missing data. Some runs may have no cost. Some PRs may be manually created outside Archie. Those records should remain visible with an `unknown_cost` or `unknown_linkage` marker instead of being silently dropped.

## GitHub Evidence Integration

The analysis needs a deeper GitHub integration than current PR status checks.

Archie should reuse the existing GitHub App/OAuth integration for V1. The current integration already stores connected GitHub users, fetches valid user tokens, creates/updates PRs, and reads basic PR status. The outcomes feature should extend that path with additional GitHub API helpers and a durable sync layer instead of introducing a separate integration.

Longer term, Archie may add GitHub App installation-token sync and webhooks for background collection that does not depend on one currently connected user's token. That should be an implementation reliability improvement, not a separate product surface.

### Required Evidence

Archie should collect:

- PR lifecycle events: opened, edited, reopened, closed, merged, converted to draft, ready for review.
- Reviews: approved, requested changes, commented, dismissed.
- Review comments: author, path, line, created time, resolved state when available.
- Issue comments on PRs.
- Review threads from GraphQL when possible, especially unresolved/resolved state.
- Commits in each PR.
- Commit authors, committers, timestamps, messages, and trailers.
- Co-author trailers.
- Files changed per PR and per commit.
- CI/check suites and check runs.
- Labels and milestone metadata.
- Revert events and merge commit SHA.
- References between PRs, issues, and commits.

### GitHub Permissions

The existing GitHub App/OAuth integration will need enough access to read:

- repository metadata
- pull requests
- issues/comments
- contents or commits
- checks/statuses

Review thread resolution state may require GitHub GraphQL because REST does not expose every review-thread detail consistently.

If webhooks are enabled, Archie should subscribe to:

- pull request
- pull request review
- pull request review comment
- issue comment
- check suite/check run
- push

V1 can combine scheduled sync and backfill first, then use webhooks for freshness.

### Sync Strategy

Use two sync paths:

1. Backfill
   - Find all PR artifacts created by Archie.
   - Find recent PRs in connected repositories.
   - Match PRs to work items by PR number, branch name, GitHub actor, co-author trailers, commit SHAs, and timestamps.

2. Incremental sync
   - Periodically refresh open PRs.
   - Refresh recently merged PRs during the configured observation window.
   - Refresh PRs referenced by new comments, labels, commits, or checks.

Default observation window:

```text
14 days after merge
```

This should be configurable in settings. A team can increase it if follow-up fixes usually land more slowly in their workflow.

## Actor And Commit Attribution

The dashboard must distinguish what the agent produced from what humans corrected later.

### Actor Registry

Archie should maintain an actor registry with:

- Archie bot GitHub username
- Archie bot email
- deploy-machine GitHub username if different
- known agent co-author names/emails
- human GitHub users connected to Archie users
- optional aliases for company bot accounts

### Commit Classification

Each commit in a PR should be classified as:

```text
agent_authored
agent_coauthored
human_authored
human_after_agent
agent_after_review
human_after_review
agent_after_ci_failure
human_after_ci_failure
unknown
```

Evidence used:

- GitHub author and committer login
- commit author email
- co-author trailers
- commit time relative to review comments and CI failures
- branch/PR association with an Archie work item
- run timestamps
- configured Archie GitHub user, bot email, and co-author identity

This enables analysis such as:

```text
PR #142 started as an Archie session.
The initial agent/co-authored commits changed 12 files.
After review, 4 human-only commits rewrote the auth/session path.
CI failed twice before the human correction commits.
The PR merged after 3 review rounds.
```

## PR Matching Without Hidden Metadata

V1 should not require hidden metadata in PR bodies.

Archie can usually detect the right PR using evidence it already has:

- `pull_request` artifacts created when Archie opens a PR.
- work item branch names.
- PR head branch names.
- commit SHAs from the worktree branch.
- the GitHub user configured on the server or connected through Archie.
- the Archie bot/co-author email when commits are co-signed.
- PR author, commit author, committer, and co-author trailers.
- timestamps around session runs, commits, PR creation, review comments, and CI events.

This avoids mutating PR descriptions and keeps V1 aligned with the current Archie workflow where the server-side GitHub user may author, open, or co-sign the work.

Hidden metadata can remain a future option if branch names and commit attribution are not reliable enough in practice.

Fallback matching signals:

- PR artifact metadata
- branch name
- head SHA
- commit timestamps
- work item env branch
- GitHub PR author
- configured server GitHub user
- Archie co-author trailer
- PR title/body similarity

## Follow-Up Fix And Regression Detection

Regression detection will never be perfect in V1, but Archie can collect strong and weak signals.

### Strong Signals

- Revert commits that reference a PR number or merge commit SHA.
- GitHub revert events.
- Follow-up PR title/body references the prior PR.
- Follow-up PR description references a bug, regression, hotfix, or prior PR.
- Commit messages say `fix regression`, `fixes #`, `revert`, or reference the earlier PR.
- A later PR links to the earlier PR through GitHub closing/reference events.

### Weak Signals

- Same files changed shortly after merge.
- Same functions or test names changed shortly after merge.
- New tests added around behavior introduced by the prior PR.
- CI failures or production incidents near the changed code path.

Weak signals should never be presented as fact. They should create a "possible follow-up" relationship with explanation and confidence.

V1 should not require teams to configure labels for bug, regression, hotfix, or follow-up fix detection. Archie should infer these relationships from PR titles, PR descriptions, commit messages, GitHub references, and changed files. Team-configured labels can be added later as a precision improvement.

## Learning Report

The learning report is the highest-value output.

It should be generated from resolved work and cite evidence. The report should not say generic things like "prompts were vague" unless the repo-specific evidence makes that useful.

Good learning examples:

- "Authentication PRs with explicit session-expiry test instructions merged with fewer review rounds."
- "Large UI changes without a generated walkthrough had more reviewer clarification comments."
- "When agents ran the app-specific `refund_webhook_test` before PR creation, reviewers rarely requested backend fixes."
- "Most human correction commits in May were around database migrations, suggesting Archie needs a stronger migration skill for this repo."
- "The strongest sessions included a narrow task, relevant file references, and validation output before PR creation."

Each learning should include:

- evidence count
- representative sessions/PRs
- confidence
- recommended team practice
- suggested Archie context/skill update when applicable

## Dashboard UX

### Global Summary

Top-level cards:

- Total LLM cost
- Cost tied to merged PRs
- Cost currently pending in open PRs
- Cost tied to closed/reverted/follow-up-fix work
- Sessions with no PR evidence
- Strong resolved sessions

### Outcome Funnel

Show counts and cost through stages:

```text
sessions -> PR created -> PR reviewed -> PR merged -> no follow-up fix detected
```

### Pending PRs

Open PR table:

- PR
- app/repo
- author
- Archie session
- current cost
- review state
- CI state
- unresolved comments
- human commits after agent commits
- age

This is operational visibility, not learning material yet.

### Resolved Sessions

Resolved table:

- quality band
- PR outcome
- cost
- review burden
- correction commit count
- CI failures/reruns
- follow-up fix signals
- representative evidence

### Learning Report

The shared report should be pattern-first:

- practices worth repeating
- recurring correction areas
- repo-specific agent setup gaps
- prompt examples worth sharing
- validation commands worth promoting
- suggested Archie skill/context updates

Shared reports should use session and PR examples by default, not developer names. Developer names can appear inside drilldown evidence when the viewer has permission and needs attribution context, but the shared learning layer should avoid person-first framing.

### Evidence Drawer

Every claim should open an evidence drawer with:

- session transcript excerpts
- PR links
- comments/review threads
- commits and attribution
- checks
- cost/run data
- follow-up relationships

## Proposed Data Model

V1 can add normalized GitHub evidence tables plus computed snapshots.

Suggested tables:

```text
github_repositories
github_pull_requests
github_pr_commits
github_pr_reviews
github_pr_comments
github_pr_checks
github_pr_events
github_pr_file_changes
github_follow_up_links
llm_outcome_snapshots
llm_learning_reports
```

### `github_pull_requests`

Stores durable PR state:

- repository
- PR number
- URL
- title
- author
- state
- draft state
- head branch
- base branch
- merge commit SHA
- opened/closed/merged timestamps
- labels
- sync timestamps

### `github_pr_commits`

Stores commit-level attribution:

- commit SHA
- PR ID
- author login/email
- committer login/email
- message
- co-author trailers
- classification
- authored/committed timestamps

### `github_pr_comments`

Stores review and discussion evidence:

- PR ID
- GitHub comment/thread ID
- comment type
- author login
- path/line when available
- body or body summary/hash, depending on retention settings
- resolved state when available
- created/updated timestamps

### `llm_outcome_snapshots`

Stores computed analysis for fast dashboard reads:

- app ID
- work item ID
- conversation ID
- session ID
- PR ID
- outcome state
- quality band
- confidence
- cost values
- review burden metrics
- correction metrics
- follow-up metrics
- evidence JSON
- computed timestamp

Snapshots are derived data. They can be recomputed as GitHub evidence changes.

## Analysis Pipeline

Suggested pipeline:

```text
sync GitHub evidence
-> match PRs to Archie work
-> classify commits and actors
-> compute PR lifecycle metrics
-> compute cost buckets
-> detect follow-up links
-> assign outcome state and quality band
-> generate learning report
```

### Metrics

Useful V1 metrics:

- LLM cost by outcome state
- PR creation rate from sessions
- merge rate for resolved PRs
- time from session start to PR open
- time from PR open to merge/close
- review count
- requested-change count
- unresolved thread count
- inline comment count
- CI failure count and rerun count
- human-only correction commits after agent commits
- agent commits after review comments
- follow-up fix links within observation window
- no-PR session count and cost

## API Shape

Suggested API routes:

```text
GET  /api/outcomes/summary
GET  /api/outcomes/sessions
GET  /api/outcomes/sessions/:id
GET  /api/outcomes/reports/latest
POST /api/outcomes/reports/generate
POST /api/github/sync
POST /api/github/webhooks
```

The global routes can accept filters:

```text
app_id
repo
author
provider
model
outcome_state
quality_band
from
to
```

## Implementation Plan

### Phase 1: Local Outcome Snapshot Without Deep GitHub Sync

- Add global `/outcomes` shell.
- Aggregate all work items, conversations, runs, sessions, and PR artifacts.
- Parse stored run cost.
- Use existing PR artifact metadata and existing PR status lookup where available.
- Show pending/open PRs separately from resolved work.
- Show honest unknown states.

This phase proves the dashboard shape.

### Phase 2: GitHub Evidence Store

- Add normalized GitHub evidence tables.
- Add repository and PR backfill.
- Sync PR lifecycle, commits, reviews, comments, and checks.
- Match PRs to Archie work items and sessions.
- Add actor registry and commit classification.

This phase makes the analysis evidence-rich.

### Phase 3: Outcome Computation

- Add `llm_outcome_snapshots`.
- Compute outcome states and quality bands.
- Compute cost by outcome.
- Compute review/correction burden.
- Detect follow-up fix links.
- Add detail drawer with cited evidence.

### Phase 4: Learning Reports

- Generate a daily learning report by default.
- Allow manual report regeneration for a chosen date range, including presets like last 14, 30, and 60 days.
- Cite concrete PRs, comments, commits, sessions, and checks.
- Produce team-specific recommendations.
- Suggest updates to Archie skills/context when repeated patterns appear.

### Phase 5: Webhooks And Freshness

- Add GitHub webhook handling.
- Keep open PRs fresh without heavy polling.
- Refresh recently merged PRs during the configured observation window.

## Security And Privacy

This feature will read and store sensitive engineering evidence.

Requirements:

- Respect existing Archie authentication and authorization.
- Keep evidence inside the customer-controlled Archie installation.
- Avoid sending raw code/comments to external model providers unless the user deliberately generates a report and provider policy allows it.
- Store raw GitHub comments in V1 so evidence can be inspected and reprocessed.
- Add configurable retention or summary-only storage later if teams need stricter data minimization.
- Mark generated learning reports with evidence links and generation timestamp.
- Avoid public sharing links in V1.
- Make it clear when evidence is incomplete.

## Resolved Questions

- The default post-merge observation window is 14 days and should be configurable in settings.
- Store raw GitHub comments in V1.
- Do not require teams to configure labels in V1. Infer bug/regression/hotfix/follow-up relationships from PR descriptions, titles, commit messages, GitHub references, and changed files.
- Shared learning reports should include session and PR examples by default, not developer names.
- Outcome reports should run daily by default and support manual reruns for user-selected date ranges such as last 14, 30, or 60 days.
- V1 should not add or backfill hidden PR metadata. Match PRs using branch names, PR artifacts, commit SHAs, server GitHub user identity, and Archie co-author evidence.

## Decision

Build this as a global learning and outcomes system.

The product should avoid premature judgment on open PRs, avoid developer ranking, and invest in GitHub evidence depth. The core value is not generic LLM coaching. The core value is team-specific learning grounded in what actually happened in the team's PRs, reviews, commits, checks, and follow-up fixes.
