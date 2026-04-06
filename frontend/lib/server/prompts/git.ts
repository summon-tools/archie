/**
 * Git-related prompt builders.
 *
 * Covers commit message and PR description generation.
 */

import { markdownOnlyInstruction } from "./shared";

// ── Commit message ────────────────────────────────────────────────────

interface CommitMessagePromptParams {
  workItemTitle: string;
  workItemKind: string;
  diffSummary: string;
}

export function buildCommitMessagePrompt({
  workItemTitle,
  workItemKind,
  diffSummary,
}: CommitMessagePromptParams): string {
  return `Generate a git commit message in Conventional Commits format.

Format: type(optional-scope): short description

Types: feat, fix, chore, refactor, docs, style, test, perf, ci, build
Scope is optional — use it only if the change is clearly scoped to one area (e.g. auth, api, ui).

TASK CONTEXT:
Title: ${workItemTitle}
Kind: ${workItemKind}

DIFF:
${diffSummary}

Rules:
- Return ONLY the commit message, nothing else
- First line must be the conventional commit format: type(scope): description
- Keep the first line under 72 characters
- If the changes are substantial, add a blank line then a brief body (2-3 lines max)
- The description should explain WHAT changed, not repeat the task title verbatim
- Use imperative mood ("add", "fix", "update", not "added", "fixed", "updated")`;
}

// ── PR description ────────────────────────────────────────────────────

interface PRDescriptionPromptParams {
  taskTitle: string;
  taskDescription?: string;
  reflectionContext: string;
  codeDiff: string;
}

export function buildPRDescriptionPrompt({
  taskTitle,
  taskDescription,
  reflectionContext,
  codeDiff,
}: PRDescriptionPromptParams): string {
  return `Generate a concise GitHub pull request description in markdown for the following task.

TASK: ${taskTitle}
${taskDescription ? `Description: ${taskDescription}` : ""}

${reflectionContext ? `CONTEXT FROM PLANNING:\n${reflectionContext}\n` : ""}
CODE DIFF:
${codeDiff.slice(-30000)}

Write a PR description with:
- A brief "## Summary" section (2-4 bullet points explaining what changed and why)
- A "## Changes" section listing key modifications
- Keep it concise and focused on what a reviewer needs to know

${markdownOnlyInstruction()}`;
}
