# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |

Only the latest version of Archie receives security updates.

## Reporting A Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use one of these private channels instead:

- **GitHub Security Advisory**  
  Use the "Report a vulnerability" button on the repository's Security Advisories page.
- **Email**  
  Send details to the maintainers using the contact listed in the repository profile.

Please include:

- a description of the issue
- reproduction steps
- impact
- any suggested mitigation or fix

We aim to acknowledge reports within 72 hours and respond with a mitigation or fix plan as quickly as possible.

## Security Posture

Archie is a **local-first development environment**.

Its security model is best understood as:

- safe for use on your own machine
- reasonable for personal remote hosting on infrastructure you control
- usable for small trusted environments

It should **not** currently be treated as a hardened multi-tenant SaaS platform.

That distinction matters because Archie is designed to work directly with:

- local repos
- git worktrees
- preview processes
- local or host-level CLI auth
- shell execution through AI tools

## Trust Model

When you run Archie, you are trusting it with access to:

- your project files
- generated worktrees
- preview/runtime logs
- local CLI auth state for tools like Claude, Codex, and GitHub CLI
- shell execution on the host where Archie runs

This is powerful and intentional, but it means Archie should be run in environments you trust.

## Authentication

Archie currently uses:

- bcrypt password hashes stored in SQLite
- signed JWT session cookies
- role-based checks for admin-only operations

Important details:

- the session cookie is `HttpOnly`
- token lifetime is currently 72 hours
- `AUTH_SECRET_KEY` is required in production
- in development, an insecure fallback key is allowed with a warning

## Local CLI Auth

Archie increasingly relies on local CLI authentication rather than storing provider secrets itself.

Examples:

- `claude auth login`
- `codex` local auth
- `gh auth login`

This means security also depends on the trustworthiness of the machine or host account running those CLIs.

## Shell And Agent Permissions

This is the most important operational security topic in the project.

Archie can invoke coding agents and local tools that read, write, and execute against your working repositories.

The `CLAUDE_DANGEROUS_PERMISSIONS` setting currently defaults to `true` in the application config. When enabled, Claude-related runs can bypass normal permission prompts and perform shell/file actions directly.

That default may be acceptable on a machine you control for personal use, but it is a significant trust boundary.

Recommendations:

- for personal local use, understand what this setting means before enabling broad automation
- for remote or shared environments, review this setting carefully
- do not expose Archie to untrusted users and assume the agent layer is safely sandboxed

## Network Exposure

By default, Archie binds to localhost-oriented settings and is safest when used behind a trusted local environment.

If you expose Archie over a network:

- use HTTPS
- put it behind a reverse proxy when appropriate
- set a strong `AUTH_SECRET_KEY`
- review cookie security settings
- restrict who can reach the service

If you run it on a remote host for yourself, treat that box as a personal development environment, not as a public SaaS service.

## Data And Secrets

Sensitive material may exist in:

- the SQLite database
- `.env`
- managed repositories and worktrees
- preview and process logs
- local CLI auth state on the host

You should assume Archie can surface or operate on whatever the host account can access.

## Best Practices

- use a strong random `AUTH_SECRET_KEY`
- prefer localhost for local use
- use HTTPS if the app is reachable over a network
- keep the machine or host account private and trusted
- review provider CLI auth state on shared or remote machines
- be cautious with `CLAUDE_DANGEROUS_PERMISSIONS`
- keep dependencies updated

## What Archie Is Not Claiming

Archie does not currently claim to provide:

- multi-tenant isolation
- hardened sandboxing between users
- strong separation between repo execution and host execution
- enterprise-grade hosted security boundaries

If you need those properties, you should assume additional hardening and architectural work is required before deployment.
