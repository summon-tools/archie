# Changelog

## v1.0.0 — 2026-02-28

Initial MVP release.

- Multi-project dashboard with Kanban boards
- AI task execution with Claude Agent SDK (Sonnet, Opus, Haiku)
- Conversational planning — chat with Claude before execution
- Git worktree isolation per task with automatic branch management
- Live preview servers (ports 9001-9050) with framework auto-detection
- Demo video generation (Playwright recording + TTS narration)
- GitHub PR creation with AI-generated descriptions and video attachments
- Per-project and global chat with Claude (session resumption)
- Team management with invitation system (admin/member roles)
- Environment variable management per project
- Git operations from the dashboard (init, commit, push, pull, SSH keys)
- GitHub import — bring in existing repos
- Production deployment with nginx reverse proxy and systemd service
- Interactive setup script with dev/production mode selection
- One-command updates via `update.sh`
- SQLite database with WAL mode and auto-migrations

### Supported Frameworks

Next.js, Express, Vite, Rails, Django, Flask

### Supported Package Managers

npm, yarn, pnpm, bun, bundle (Ruby), pip (Python)
