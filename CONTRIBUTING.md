# Contributing to Archie

Thanks for your interest in contributing.

Archie is a self-hosted, open-source AI development environment. The best way to contribute is to run it locally, understand the product model, and make focused changes that keep the codebase and docs aligned.

## Before You Start

Please read:

- [README.md](README.md)
- [docs/tools.md](docs/tools.md)
- [SECURITY.md](SECURITY.md)

Those documents explain the current product direction, runtime model, and trust boundaries.

## Prerequisites

For normal local development, you should have:

- macOS or Linux
- Git
- Node.js `20.9+`
- Node.js `22.x` recommended
- npm

Helpful local tools:

- `claude auth login`
- `gh auth login`
- optional: `codex` if you are working on Codex integration
- optional: `ffmpeg` and Playwright browsers for demo-related work

## Local Setup

Clone the repo and bootstrap it:

```bash
git clone https://github.com/<your-username>/archie.git
cd archie
bash scripts/bootstrap-local.sh
cd frontend
npm run dev
```

Then open [http://localhost:8080](http://localhost:8080).

Use the in-app setup wizard to configure:

- your account
- projects directory
- git identity
- GitHub CLI
- system readiness

## Project Layout

The most important places to know are:

- `frontend/app/`
  - Next.js routes and pages
- `frontend/components/`
  - UI components
- `frontend/hooks/`
  - client-side state and streaming hooks
- `frontend/lib/server/`
  - server logic, agent orchestration, DAL, worktrees, git, project context, and runtime management
- `docs/`
  - project documentation

## Product Concepts

A few concepts matter a lot when working in this codebase:

- **Thread**
  - the conversation
- **Work item**
  - the tracked unit of work linked to a thread
- **Spec**
  - curated description of what the app does
- **Skills**
  - curated description of how the team works in the repo
- **Codebase Index**
  - generated codebase context cache
- **Inbox**
  - review surface for background proposals

When in doubt, preserve these distinctions rather than collapsing them together.

## Development Workflow

Create a branch from `main`:

```bash
git checkout -b my-change
```

Make focused changes and keep related docs updated.

If your change affects:

- product concepts
- setup flow
- architecture
- security assumptions

please update the relevant docs in the same branch.

## Testing

From `frontend/`, the main commands are:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
```

Notes:

- `test:e2e` depends on a compatible local Node version and Playwright setup
- some features depend on local tools or CLIs that are not required for every contribution
- if you cannot run a specific test layer, mention that clearly in your PR

## Code Style

General expectations:

- keep changes focused
- prefer clear code over clever abstractions
- preserve the self-hosted product assumptions unless you are intentionally changing them
- keep provider integrations provider-neutral where possible
- avoid introducing hidden automation for important user decisions

## Pull Requests

When opening a PR:

- explain what changed
- explain why it changed
- mention any user-facing behavior differences
- mention any setup, migration, or trust-model implications
- mention what you tested locally

If something is incomplete, say so explicitly.

## Reporting Bugs And Suggesting Features

Use [GitHub Issues](../../issues) to report bugs or suggest features. Please search first to avoid duplicates.

## Questions

If something in the codebase or docs is unclear, open an issue or start a discussion rather than guessing silently. Clear mental models matter a lot in this project.
