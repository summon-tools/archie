/**
 * Shared prompt fragments.
 *
 * Small helpers that return commonly repeated instruction text.
 * Import these from domain-specific prompt modules to avoid drift.
 */

/** Instruct the model to return only a JSON object with no markdown fences. */
export function jsonOnlyInstruction(): string {
  return "Return ONLY the JSON object, no markdown fences or extra text.";
}

/** Instruct the model to return only raw code with no markdown fences or explanation. */
export function codeOnlyInstruction(): string {
  return "Output ONLY the code — no markdown fences, no explanation, no commentary.";
}

/** Instruct the model to return only markdown content with no fences or preamble. */
export function markdownOnlyInstruction(): string {
  return "Return ONLY the markdown content. No fences or preamble.";
}

/** Standard YAML frontmatter rules for spec files. */
export function specFrontmatterRules(): string {
  return `Each file MUST start with YAML frontmatter (--- delimited) containing:
- kind: feature | integration | model | page | flow
- area: the product area (e.g. auth, billing, dashboard)
- status: draft | active | deprecated
- tags: list of tags

Then: # Title, > summary, ## Behaviour, ## Context, ## Decisions`;
}

/** Playwright selector priority rules shared across demo/walkthrough prompts. */
export function playwrightSelectorRules(): string {
  return `Selector priority (use the first available match):
1. Exact href attribute for links/nav
2. Exact visible text content
3. Exact name/placeholder attributes
4. Role-based selectors as last resort

NEVER use :has-text(), :has(), >>, or locator-only pseudo-selectors with page.click().`;
}
