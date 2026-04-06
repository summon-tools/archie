/**
 * Spec-related prompt builders.
 *
 * Covers spec generation, validation, drift rewriting, and task proposal.
 */

import { jsonOnlyInstruction, specFrontmatterRules } from "./shared";

// ── Spec generation ───────────────────────────────────────────────────

interface SpecGenerationPromptParams {
  appName: string;
  directory: string;
  specPath: string;
}

export function buildSpecGenerationPrompt({
  appName,
  directory,
  specPath,
}: SpecGenerationPromptParams): string {
  return `You are generating a living specification for the web application "${appName}" located at ${directory}.

WORKFLOW:
1. Explore the project structure, routes, models, auth setup, and key features.
2. As you discover each feature area, WRITE the spec file directly to disk at ${specPath}/<area>/<feature>.md using your file tools.
3. After writing ALL spec files, write the index file at ${specPath}/_index.md.

EXPLORATION STEPS:
1. Read the project structure (package.json, Gemfile, requirements.txt, etc.)
2. Find all routes/endpoints (routes.rb, app/routes, pages/, etc.)
3. Read the data models/schema (schema.rb, prisma/schema.prisma, models/, migrations/)
4. Find the authentication setup (devise, auth middleware, session management)
5. Identify the main features and user flows

IMPORTANT — WRITE FILES DIRECTLY:
- Do NOT return JSON. Do NOT accumulate files in memory.
- Write each spec file to disk immediately after drafting it using your file write tool.
- Create subdirectories as needed (auth/, crud/, admin/, etc.)
- After all spec files are written, write ${specPath}/_index.md

SPEC FILE FORMAT — each .md file should follow this template:
---
kind: feature
area: auth
status: current
tags: [login, session]
---
# Feature Name

> One-line summary for the index.

## Behaviour
What the feature does from the user's perspective.

## Context
Technical details: routes, models, fields, credentials, URLs.

## Decisions
Architectural choices with reasoning.

FRONTMATTER FIELDS:
- kind: feature, model, route, config, or integration
- area: the feature area (auth, crud, admin, etc.)
- status: current, deprecated, or planned
- tags: relevant keywords for search/matching

INDEX FILE FORMAT — ${specPath}/_index.md:
# ${appName}

- path/to/file.md: One-line summary from the > blockquote
- another/file.md: Another summary

(One line per spec file, using the relative path within ${specPath}/)

GUIDELINES:
- Organize by feature area (auth/, crud/, admin/, dashboard/, etc.)
- Include credentials/default accounts if found in seeds or fixtures
- Document ALL routes with their paths and purposes
- List model fields, relationships, and validations
- Note any role-based access control
- Keep each file focused on one feature area
- Be thorough but concise — facts over prose
- Include YAML frontmatter in each file
- Start each file with the --- frontmatter block, then the markdown
- No preamble, no explanations — just the spec content in each file`;
}

// ── Spec validation ───────────────────────────────────────────────────

interface SpecValidationPromptParams {
  appName: string;
  directory: string;
  specSummary: string;
  filePaths: string[];
}

export function buildSpecValidationPrompt({
  appName,
  directory,
  specSummary,
  filePaths,
}: SpecValidationPromptParams): string {
  return `You are validating whether the living specification for "${appName}" (at ${directory}) matches the actual codebase.

SPEC FILES TO VALIDATE:
${specSummary}

For EACH spec file listed below, explore the actual codebase to check if what the spec describes matches reality. Look at routes, models, components, and behaviour described in each spec file.

FILES: ${filePaths.join(", ")}

Return a JSON object (no markdown fences):
{
  "results": [
    {
      "path": "auth/login.md",
      "status": "ok",
      "detail": "Routes and behaviour match the spec."
    },
    {
      "path": "crud/users.md",
      "status": "drifted",
      "detail": "Spec says users have an 'avatar' field but the model no longer has it."
    },
    {
      "path": "admin/dashboard.md",
      "status": "missing",
      "detail": "The admin dashboard route described in the spec does not exist in the codebase."
    }
  ]
}

STATUS VALUES:
- "ok": spec accurately describes the codebase
- "drifted": spec exists but some details don't match the code
- "missing": the feature described in the spec doesn't exist in the codebase

Be specific about what drifted — name the exact fields, routes, or behaviours that differ.`;
}

// ── Spec drift rewrite ────────────────────────────────────────────────

interface SpecDriftRewritePromptParams {
  appName: string;
  directory: string;
  specPath: string;
  oldContent: string;
  driftDetail: string;
}

export function buildSpecDriftRewritePrompt({
  appName,
  directory,
  specPath,
  oldContent,
  driftDetail,
}: SpecDriftRewritePromptParams): string {
  return `Rewrite this spec file for "${appName}" to match the current codebase at ${directory}.

SPEC FILE: ${specPath}

CURRENT SPEC CONTENT:
${oldContent.slice(0, 3000)}

DRIFT DETAIL (what doesn't match):
${driftDetail}

Explore the relevant parts of the codebase to understand the current state, then rewrite the spec file to accurately describe what exists now.

STRICT OUTPUT RULES:
1. Output ONLY the spec file content — nothing else. No explanations, no changelog, no "here is the rewritten spec", no summary of changes.
2. Start with the YAML frontmatter block delimited by --- on its own line, then the markdown content.
3. Follow this exact structure:

---
kind: feature
area: the-area
status: current
tags: [tag1, tag2]
---
# Title

> One-line summary.

## Behaviour
...

## Context
...

## Decisions
...

4. Do NOT append any commentary, diff summary, or "changes made" section after the spec content.
5. Do NOT wrap the output in code fences.`;
}

// ── Task proposal from spec change ────────────────────────────────────

interface SpecTaskProposalPromptParams {
  appName: string;
  specPath: string;
  diff: string;
  newContent: string;
}

export function buildSpecTaskProposalPrompt({
  appName,
  specPath,
  diff,
  newContent,
}: SpecTaskProposalPromptParams): string {
  return `A spec file was just updated for "${appName}".

FILE: ${specPath}

CHANGES (diff):
${diff || "(no textual diff detected)"}

FULL NEW CONTENT (for context):
${newContent.slice(0, 3000)}

Determine if this spec change implies work that should be tracked as a task.

Return { "needs_task": true } if ANY of these apply:
- New features, sections, or capabilities were added
- Existing behaviour was changed or extended
- New requirements, constraints, or integrations were described
- Content was added that doesn't exist in the codebase yet

Return { "needs_task": false } ONLY if the change is purely cosmetic: typos, formatting, rewording of existing documented behaviour.

When in doubt, return needs_task: true. It's better to suggest a task that gets dismissed than to miss real work.

If needs_task is true, return:
{
  "needs_task": true,
  "title": "Short task title (imperative, e.g. 'Add blog management to admin')",
  "description": "What needs to be implemented to match the updated spec."
}

If needs_task is false, return:
{ "needs_task": false }

${jsonOnlyInstruction()}`;
}
