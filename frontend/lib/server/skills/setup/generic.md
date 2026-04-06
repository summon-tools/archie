# Setup Project

You are setting up "{{APP_NAME}}" at `{{DIRECTORY}}`. The tech stack was not automatically detected, so you need to investigate the project thoroughly.

## Generated manifest
A runtime manifest has been generated at `.archie/app.yaml`:
```yaml
{{MANIFEST_YAML}}
```

## Your job
1. **Investigate the project thoroughly** — read README, package.json, Gemfile, requirements.txt, go.mod, Cargo.toml, Dockerfile, Makefile, etc.
2. **Determine the tech stack** — language, framework, package manager, database, how to start the dev server
3. **Check that required tools are available** — do NOT install system-level tools
4. **Update the manifest** — the auto-generated manifest may be wrong for unknown frameworks; fix it
5. Install **project-level** dependencies only
6. Set up environment (.env files, database if already running)
7. Report what was done and what the user needs to fix manually

## LOCAL-FIRST RULES — READ CAREFULLY
You are running on the developer's local machine. You MUST NOT install, upgrade, or modify any system-level tools. This includes:
- **Language runtimes** — do NOT install Node, Ruby, Python, Go, Rust, or any version of them
- **Version managers** — do NOT run `nvm install`, `rbenv install`, `pyenv install`, or similar
- **System packages** — do NOT run `brew install`, `apt install`, `sudo` anything
- **Database servers** — do NOT install or start PostgreSQL, MySQL, Redis, MongoDB, etc.
- **System libraries** — do NOT install `libpq-dev`, `openssl`, `readline`, or any system-level library

If a required tool is missing or the wrong version, **stop and report it clearly**. Tell the user:
- What is missing (e.g. "Ruby 3.2.10 is required but ruby was not found on the system")
- How they can install it themselves using their preferred tool manager
- What will fail without it

## Investigation checklist
- `README.md` — setup instructions
- `package.json` — Node.js project (scripts.dev, scripts.start, main/module fields)
- `Gemfile` — Ruby project
- `requirements.txt`, `Pipfile`, `pyproject.toml` — Python project
- `go.mod` — Go project
- `Cargo.toml` — Rust project
- `pom.xml`, `build.gradle` — Java project
- `docker-compose.yml`, `Dockerfile` — containerized setup (note services needed)
- `Makefile` — may have setup/run targets
- `.env.example` — required environment variables

## What you CAN install (project-scoped only)
- `npm install` / `yarn install` / `pnpm install` — project node_modules
- `bundle install` — project gems (if Ruby is available)
- `pip install -r requirements.txt` inside a `.venv` — project Python deps
- `cargo build` — project Rust deps
- `go mod download` — project Go deps

## What you MUST NOT install
- Any system binary, runtime, version manager, database server, or system library
- Anything requiring `sudo`, `brew install`, `apt install`, or compilation of a language runtime

## CRITICAL RULES
- The app MUST bind to port {{PORT}}
- Do NOT create start.sh/stop.sh — the manifest is the runtime contract
- If you edit app.yaml, keep the YAML format valid
- If you cannot determine how to start the project, update the manifest with your best guess and document what you tried
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
