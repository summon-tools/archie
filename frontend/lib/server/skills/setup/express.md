# Setup Express/Node.js Project

You are setting up "{{APP_NAME}}" at `{{DIRECTORY}}`.

## Generated manifest
A runtime manifest has been generated at `.archie/app.yaml`:
```yaml
{{MANIFEST_YAML}}
```

## Your job
1. Read the project (README, package.json, entry point) to understand special requirements
2. **Check that required tools are available** — do NOT install system-level tools
3. Verify the manifest is correct — adjust if needed
4. Install **project-level** dependencies only
5. Set up environment (.env files)
6. Report what was done and what the user needs to fix manually

## LOCAL-FIRST RULES — READ CAREFULLY
You are running on the developer's local machine. You MUST NOT install, upgrade, or modify any system-level tools. This includes:
- **Node versions** — do NOT run `nvm install`, `fnm install`, `n install`, or similar
- **System packages** — do NOT run `brew install`, `apt install`, `sudo` anything
- **Database servers** — do NOT install or start PostgreSQL, MySQL, Redis, etc.

If a required tool is missing or the wrong version, **stop and report it clearly**. Tell the user:
- What is missing
- How they can install it themselves
- What will fail without it

## Express/Node.js conventions
- **Node.js**: Check `.nvmrc` or `.node-version` — verify the host machine has the right version. If not, **report it and stop**.
- **Package manager**: {{PACKAGE_MANAGER}} — only install if `node_modules` is missing. This is project-scoped and safe.
- **Environment**: Copy `.env.example` to `.env`, ensure PORT={{PORT}}
- **Port config**: Verify the app reads from `process.env.PORT` — if hardcoded, update it
- **Dev command**: Check `package.json` scripts — prefer `scripts.dev`, fall back to `scripts.start`, then `node <main>`
- **Database**: Check dependencies for `pg`, `mongoose`, `redis`, `ioredis` — only run migrations if the database server is already running. If not, report it.

## CRITICAL RULES
- The app MUST bind to port {{PORT}}
- Do NOT create start.sh/stop.sh — the manifest is the runtime contract
- If you edit app.yaml, keep the YAML format valid
- **NEVER install system-level tools — only report what is missing**

## When you're done
Once setup is complete, end your final message with a clear summary that includes:

1. **What was done** — dependencies installed, env files created, manifest verified, etc.
2. **What needs manual attention** — missing tools, database servers to start, credentials to configure, etc.
3. **Next steps to get these changes into your repo:**
   - All setup work lives on the `setup-archie` branch — your main branch is untouched
   - Use the **Push** and **Create PR** buttons in the conversation header to push the branch and open a pull request
   - Review and merge the PR in GitHub to complete the setup
   - The `.archie/` folder contains Archie's runtime configuration for your project
