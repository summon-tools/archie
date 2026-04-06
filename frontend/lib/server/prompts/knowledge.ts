/**
 * Codebase index-related prompt builders.
 *
 * Covers the codebase indexer and work-item brief generation.
 */

import { jsonOnlyInstruction } from "./shared";

// ── Codebase indexer ──────────────────────────────────────────────────

interface KnowledgeIndexerPromptParams {
  directory: string;
}

export function buildKnowledgeIndexerPrompt({
  directory,
}: KnowledgeIndexerPromptParams): string {
  return `You are analyzing a codebase to produce structured codebase index sections. Explore the project at ${directory} and return a JSON array of codebase index sections.

EXPLORATION STEPS:
1. Read package.json/Gemfile/requirements.txt to identify the framework
2. Read the routes/endpoints (routes.rb, app/routes, pages/, etc.)
3. Read the data models/schema
4. Check authentication/authorization setup
5. Identify key features, background jobs, config patterns

OUTPUT:
Return a JSON array (no markdown fences) where each item has:
{
  "topic": "brief",
  "label": "App Brief",
  "content": "markdown content"
}

REQUIRED TOPICS:
- "brief" — 2-3 paragraph overview: what the app does, tech stack, key patterns. ALWAYS include this.

OPTIONAL TOPICS (include only what's relevant):
- "routes" — route map with HTTP methods, paths, controller/handler names
- "models" — data models with fields, relationships, validations
- "auth" — authentication/authorization setup, roles, session management
- "components" — key UI components and their purpose (for frontend-heavy apps)
- "jobs" — background jobs, scheduled tasks, workers
- "config" — important configuration, environment variables, feature flags
- "api" — external API integrations

GUIDELINES:
- Be thorough but concise — facts over prose
- Include actual route paths, model field names, etc.
- For routes, include the HTTP method and path at minimum
- For models, include field names and types
- Only include topics that have meaningful content in the codebase
- Each content field should be well-structured markdown

Return ONLY the JSON array.`;
}

// ── Work-item brief ───────────────────────────────────────────────────

interface WorkItemBriefPromptParams {
  taskTitle: string;
  taskSummary?: string | null;
  messageContext: string;
  diffStat: string;
  changedFiles: string;
}

export function buildWorkItemBriefPrompt({
  taskTitle,
  taskSummary,
  messageContext,
  diffStat,
  changedFiles,
}: WorkItemBriefPromptParams): string {
  return `Summarize the work done for this task. Return a JSON object (no markdown fences).

TASK: ${taskTitle}
${taskSummary ? `DESCRIPTION: ${taskSummary.slice(0, 1000)}` : ""}

CONVERSATION:
${messageContext}

GIT DIFF STAT:
${diffStat || "(no changes)"}

CHANGED FILES:
${changedFiles || "(none)"}

Return JSON:
{
  "goal": "one sentence describing what was accomplished",
  "decisions": [{"what": "what was decided", "why": "reasoning"}],
  "files_changed": ["list of key files modified"],
  "files_read": ["list of key files that were read for context"],
  "routes_affected": ["any routes/endpoints that were added or changed"],
  "models_affected": ["any data models that were added or changed"],
  "follow_up_concerns": ["anything left unfinished or needing attention"]
}

Be concise. Only include non-empty arrays where applicable.`;
}
