export type GitChatIntent =
  | "none"
  | "push"
  | "publish_pr"
  | "update_pr"
  | "pull_worktree"
  | "pull_app_default";

export interface GitChatIntentResult {
  type: GitChatIntent;
}

interface DetectGitChatIntentOptions {
  hasWorkItem?: boolean;
}

const QUESTION_OR_EXPLANATION_PATTERNS = [
  /\bhow\s+(do|can|would|should)\s+i\b/,
  /\bhow\s+(do|can|would|should)\s+we\b/,
  /\bwhat\s+(happen|happened|would happen|will happen|does|do|is)\b/,
  /\bwhy\s+(did|does|would|is|are)\b/,
  /\bexplain\b/,
  /\btell\s+me\s+about\b/,
  /\bwhat\s+is\b/,
  /\bwhat\s+are\b/,
];

function normalizeMessage(content: string): string {
  return content
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionOrExplanation(text: string): boolean {
  return QUESTION_OR_EXPLANATION_PATTERNS.some((pattern) => pattern.test(text));
}

function hasPrTerm(text: string): boolean {
  return /\b(pr|pull request)\b/.test(text);
}

function hasCreatePrIntent(text: string): boolean {
  return (
    /\b(create|open|make|submit|raise|publish|prepare)\b(?:\s+\w+){0,5}\s+\b(the\s+|a\s+|new\s+)?(pr|pull request)\b/.test(text) ||
    /\b(pr|pull request)\b(?:\s+\w+){0,5}\s+\b(create|opened|made|submitted|raised|published|prepared)\b/.test(text) ||
    /\bcommit\b.*\bpush\b.*\b(pr|pull request)\b/.test(text) ||
    /\bpush\b.*\b(create|open|make|submit|raise)\b.*\b(pr|pull request)\b/.test(text)
  );
}

function hasUpdatePrIntent(text: string): boolean {
  return (
    /\b(update|refresh|edit|revise|amend)\b(?:\s+\w+){0,5}\s+\b(the\s+|current\s+)?(pr|pull request)\b/.test(text) ||
    /\b(pr|pull request)\b(?:\s+\w+){0,5}\s+\b(update|refresh|edit|revise|amend)\b/.test(text)
  );
}

function hasPushIntent(text: string): boolean {
  return (
    /\bcommit\b.*\bpush\b/.test(text) ||
    /\bpush\b(?:\s+\w+){0,5}\s+\b(branch|changes|commits|this branch|current branch|to github|to origin)\b/.test(text) ||
    /\b(push|publish)\s+(it|this|the branch|current branch)\b/.test(text) ||
    /\bpublish\b(?:\s+\w+){0,4}\s+\b(branch|changes)\b/.test(text)
  );
}

function hasPullDefaultIntent(text: string): boolean {
  return (
    /\b(pull|sync|fetch|update)\b(?:\s+\w+){0,6}\s+\b(main|master|default branch|base branch)\b/.test(text) ||
    /\b(main|master|default branch|base branch)\b(?:\s+\w+){0,6}\s+\b(pull|sync|fetch|update)\b/.test(text)
  );
}

function hasPullWorktreeIntent(text: string): boolean {
  if (hasPrTerm(text)) return false;
  return (
    /\bgit pull\b/.test(text) ||
    /\bpull\s+(latest|changes|this branch|current branch|from origin|from remote)\b/.test(text) ||
    /\bsync\s+(this branch|current branch|branch|latest|from origin|from remote)\b/.test(text) ||
    /\bfetch\s+(latest|changes)\b/.test(text) ||
    /\bupdate\s+(this branch|current branch|branch)\b/.test(text)
  );
}

export function detectGitChatIntent(
  content: string,
  options: DetectGitChatIntentOptions = {},
): GitChatIntentResult {
  const text = normalizeMessage(content);
  if (!text) return { type: "none" };

  if (isQuestionOrExplanation(text)) return { type: "none" };

  if (hasUpdatePrIntent(text)) return { type: "update_pr" };
  if (hasCreatePrIntent(text)) return { type: "publish_pr" };
  if (hasPushIntent(text)) return { type: "push" };
  if (hasPullDefaultIntent(text)) return { type: "pull_app_default" };
  if (hasPullWorktreeIntent(text)) {
    return { type: options.hasWorkItem === false ? "pull_app_default" : "pull_worktree" };
  }

  return { type: "none" };
}
