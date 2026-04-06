# Setup Ruby on Rails Project

You are setting up "{{APP_NAME}}" at `{{DIRECTORY}}`.

## Generated manifest
A runtime manifest has been generated at `.archie/app.yaml`:
```yaml
{{MANIFEST_YAML}}
```

## Your job
1. Read the project (README, Gemfile, config/database.yml, Procfile.dev) to understand special requirements
2. **Check that required tools are available** — do NOT install system-level tools
3. Verify the manifest is correct — adjust if needed (especially the `processes` section)
4. Install **project-level** dependencies only (bundle install, JS deps)
5. Set up environment (.env files, database if already running)
6. Report what was done and what the user needs to fix manually

## LOCAL-FIRST RULES — READ CAREFULLY
You are running on the developer's local machine. You MUST NOT install, upgrade, or modify any system-level tools. This includes:
- **Ruby versions** — do NOT run `rbenv install`, `rvm install`, `asdf install`, or compile Ruby
- **Node versions** — do NOT run `nvm install`, `fnm install`, or similar
- **System packages** — do NOT run `brew install`, `apt install`, `sudo` anything
- **Database servers** — do NOT install or start PostgreSQL, MySQL, Redis, etc.
- **Language runtimes** — do NOT install Python, Go, Rust, or any other runtime

If a required tool is missing or the wrong version, **stop and report it clearly**. Tell the user:
- What is missing (e.g. "Ruby 3.2.10 is required but not found")
- How they can install it themselves (e.g. "Install it with your preferred Ruby version manager")
- What will fail without it

## Multi-process apps
Many Rails apps need multiple processes in development (web server, JS bundler, CSS watcher, background workers). The manifest supports this with a `processes` array. If the project has a `Procfile.dev`, the manifest should already include these processes. Verify they are correct.

Example manifest with processes:
```yaml
processes:
  - name: web
    command: bundle exec rails server -p $PORT -b 0.0.0.0
    web: true
  - name: js
    command: yarn build --watch
  - name: css
    command: yarn build:css --watch
```

The process marked `web: true` is the primary process that binds to $PORT. All other processes are started alongside it automatically by the runner.

If the project has a `Procfile.dev` but the manifest does NOT have a `processes` section, add one based on the Procfile.dev content.

**Important:** The `worktree.prepare_command` should include one-shot asset builds so assets are compiled before the preview starts. For example, if the js process runs `yarn build --watch`, the prepare_command should include `yarn build` (without `--watch`). The manifest generator does this automatically, but verify it's correct.

## Ruby version check
The project will specify a Ruby version in `.ruby-version` or `.tool-versions`. You must verify the host machine has it **before** running bundle install.

Check in this order:
1. Read `.ruby-version` (or `.tool-versions`) to find the required version
2. Run `ruby --version` to see what's currently active
3. Detect the user's version manager:
   - **rbenv**: Run `rbenv versions` to list installed versions. If the required version is installed but not active, tell the user to run `rbenv install <version>` or `rbenv local <version>`.
   - **rvm**: Run `rvm list` to list installed versions. If the required version is installed but not active, tell the user to run `rvm use <version>`.
   - **asdf**: Run `asdf list ruby` to list installed versions. If the required version is installed but not active, tell the user to run `asdf install ruby <version>`.
   - If none of these are found, just report that Ruby is needed and suggest installing a version manager.
4. If the required version is **not installed at all**, stop and report clearly:
   - Which version is required
   - Which version manager they have (rbenv, rvm, asdf, or none)
   - The exact command to install it (e.g. `rbenv install 3.2.10`, `rvm install 3.2.10`)
   - Do NOT run the install command yourself

## Rails conventions
- **Bundle**: Run `bundle check > /dev/null 2>&1 || bundle install` — this is project-scoped and safe
- **JS deps**: Use {{PACKAGE_MANAGER}} if detected — only install if `node_modules` is missing
- **Database** ({{DATABASE}}): Only run `bundle exec rails db:create` and `db:migrate` if the database server is already running. If not, report it.
- **PostgreSQL**: Check if `psql` is available and the server is running. If not, tell the user to start it. Do NOT create roles or install packages.
- **Redis**: Check if referenced in Gemfile/Procfile. If needed but not running, report it.
- **Environment**: Copy `.env.example` to `.env`, ensure PORT={{PORT}} is set
- **Binding**: The manifest sets BINDING=0.0.0.0 — Puma in dev mode defaults to localhost without this
- **Assets**: Try `yarn build` / `yarn build:css` if applicable (ignore errors)

## CRITICAL RULES
- The app MUST bind to port {{PORT}}
- Do NOT create start.sh/stop.sh — the manifest is the runtime contract
- If you edit app.yaml, keep the YAML format valid
- **NEVER install system-level tools — only report what is missing**
- **NEVER run `rails credentials:edit`** or `rails credentials:setup` — encrypted credentials require a TTY editor and generate files (e.g. `production.yml.enc`) that should not be auto-created. If the app needs credentials configured, tell the user to do it themselves.

## When you're done
Once setup is complete, end your final message with a clear summary that includes:

1. **What was done** — dependencies installed, env files created, manifest verified, etc.
2. **What needs manual attention** — missing tools, database servers to start, credentials to configure, etc.
3. **Next steps to get these changes into your repo:**
   - All setup work lives on the `setup-archie` branch — your main branch is untouched
   - Use the **Push** and **Create PR** buttons in the conversation header to push the branch and open a pull request
   - Review and merge the PR in GitHub to complete the setup
   - The `.archie/` folder contains Archie's runtime configuration for your project
