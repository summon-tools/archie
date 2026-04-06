/**
 * Intent classification prompt builder.
 */

// ── Message classification ────────────────────────────────────────────

interface IntentClassificationPromptParams {
  message: string;
  categories: string;
}

export function buildIntentClassificationPrompt({
  message,
  categories,
}: IntentClassificationPromptParams): string {
  return `Classify this user message into exactly one category. Reply with ONLY the category word, nothing else.

Categories:
${categories}
- code: EVERYTHING ELSE — coding tasks, bug fixes, general questions, refactoring, etc. When in doubt, choose code.

IMPORTANT DISTINCTIONS:
- "walk me through the code changes" or "explain the diff" → code-walkthrough (narrated code review)
- "walk me through the app" or "show me the features" → walkthrough (live UI tour)
- "what should I build?" or "fix the login bug" → code (regular chat)

User message: "${message.slice(0, 500)}"

Category:`;
}
