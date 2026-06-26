/**
 * Demo / walkthrough / video prompt builders.
 *
 * Covers script fixing, navigation script generation, walkthrough steps,
 * code walkthrough plans, and live walkthrough generation.
 *
 * NOTE: buildSeedPrompt and buildAdaptSeedPrompt stay in lib/server/demo.ts
 * because they have side effects (assembleContext, getSeedTool).
 */

import { codeOnlyInstruction, playwrightSelectorRules } from "./shared";

// ── Fix broken script ─────────────────────────────────────────────────

interface FixScriptPromptParams {
  originalScript: string;
  errors: string[];
  pageSnapshot: string;
}

export function buildFixScriptPrompt({
  originalScript,
  errors,
  pageSnapshot,
}: FixScriptPromptParams): string {
  return `You are fixing a Playwright demo script that failed during recording.

═══ ORIGINAL SCRIPT ═══
${originalScript}

═══ ERRORS DURING RECORDING ═══
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

═══ CURRENT PAGE SNAPSHOT (what the browser actually sees) ═══
${pageSnapshot}

Fix the script so that all failing steps work correctly:
- Replace broken selectors with ones matching elements from the PAGE SNAPSHOT above
- If a page.goto() failed, the URL doesn't exist — use a link from the snapshot or remove that navigation
- If a click/fill failed, the selector doesn't match any element — find the right selector from the snapshot
- If the script never navigates to the right page before interacting, add the missing navigation step
- Keep all working steps unchanged
- Keep all // NARRATE: comments

═══ OUTPUT FORMAT ═══
Return ONLY the fixed JavaScript code. No explanations, no markdown fences. // NARRATE: comments are the only comments allowed.`;
}

// ── Navigation script (video demo) ────────────────────────────────────

interface NavigationScriptPromptParams {
  taskTitle: string;
  taskDescription?: string;
  previewUrl: string;
  worktreeDir?: string;
  credsContext: string;
  crawlContext: string;
  additionalContext: string;
  contextSection: string;
}

export function buildNavigationScriptPrompt({
  taskTitle,
  taskDescription,
  previewUrl,
  worktreeDir,
  credsContext,
  crawlContext,
  additionalContext,
  contextSection,
}: NavigationScriptPromptParams): string {
  return `You generate a Playwright script to record a video demo of a web app feature.

TASK: ${taskTitle}
${taskDescription ? `Description: ${taskDescription}` : ""}
App URL: ${previewUrl}
${worktreeDir ? `Working directory: ${worktreeDir}\n` : ""}${credsContext}
${crawlContext}
${additionalContext}
${contextSection}

═══ NEVER GUESS ROUTES — THIS IS MANDATORY ═══
You MUST verify every URL before using it in the script. A wrong URL causes a blank page and a failed video.
- Read the routes file FIRST to know which URLs exist
- Cross-check URLs against the RENDERED PAGE SNAPSHOTS (links visible on each page)
- If you cannot confirm a route exists in the routes file or page snapshots, DO NOT use it
- NEVER construct URLs by guessing patterns (e.g. don't assume /users/1/edit exists just because /users exists)

EXPLORE THE CODEBASE BEFORE WRITING THE SCRIPT:
1. Read the routes file (\`config/routes.rb\`, \`src/app/**/page.tsx\`, or equivalent) to understand ALL available URLs
2. Read the code diff to understand what was changed: run \`git diff main --no-color -- '*.tsx' '*.ts' '*.jsx' '*.js' '*.rb' '*.py' '*.erb' '*.html' ':!node_modules' ':!*.config.*' ':!*.lock'\` using bash
3. Read specific source files relevant to the task (controllers, views, components)
4. ONLY use routes that actually exist in the routes file — if a route is not there, do NOT use it

The script receives a \`page\` variable (Playwright Page) already navigated to the app URL.
If personas are available, you can call \`await loginAs("PersonaName")\` to log in as that persona.

═══ SCOPE — THIS IS CRITICAL ═══
The demo MUST focus on what the TASK actually changed. Read the code diff and source files to understand the scope.
- If the task is a small change (text update, styling fix, single component tweak), keep the demo SHORT (15-25s) — show ONLY the change itself, don't explore unrelated pages or workflows.
- If the task is a full feature (new page, new workflow, CRUD operations), make a fuller demo (30-60s) showing the feature end-to-end.
- If CHAT HISTORY is provided, it shows ALL requests the user made during this task. The demo MUST cover ALL changes, not just the original task title.
- NEVER navigate to pages or perform actions that are unrelated to what the task changed. Stay focused.

GOAL: Use the code diff and source files to understand what was actually changed. Then use the RENDERED PAGE SNAPSHOTS to write accurate selectors. Only demo what was built or modified.

Structure based on task scope:

FOR SMALL CHANGES (text, styling, i18n, config):
1. Navigate to the page where the change is visible
2. Show the change clearly (scroll to it, pause on it)
3. If the change affects multiple views (e.g. i18n), show each view
4. Brief closing narration — done

FOR FULL FEATURES (new pages, workflows, CRUD):
1. INTRODUCTION (5-10s): Start on the landing/home page. Narrate what the app does.
2. EXPLORATION (10-15s): Navigate to 2-3 key pages relevant to the feature.
3. INTERACTION (15-25s): Complete one core workflow end-to-end (e.g. create an item, fill a form, submit, verify result).
4. CONCLUSION (3-5s): Brief closing narration.

═══ SELECTORS ═══
- Use ONLY elements from the RENDERED PAGE SNAPSHOTS. Every selector you write MUST correspond to an element you can see in those snapshots.
- Selector priority:
  1. \`page.click('a[href="/exact-path"]')\` — use the exact href from the snapshot
  2. \`page.click('text=Exact Text')\` — use the exact button/link text from the snapshot
  3. \`page.fill('input[name="field"]', 'value')\` — use the exact name attribute from the snapshot
  4. \`page.fill('input[placeholder="Search..."]', 'value')\` — use the exact placeholder
- NEVER invent selectors for elements not in the snapshots.
- NEVER use \`:has-text()\`, \`:has()\`, or any pseudo-selectors that are only available via Playwright locators — they do NOT work with \`page.click()\`. Use \`text=Exact Text\` instead.
- NEVER use \`>>\` (Playwright locator chaining syntax). It only works with \`page.locator()\`, NOT with \`page.click()\`.
- DROPDOWN SNAPSHOTS show menu items that appear when a trigger is clicked. To interact with a dropdown:
  1. Click the trigger button: \`await page.click('text=FR')\`
  2. Wait for menu: \`await page.waitForTimeout(300)\`
  3. Click the menu item: \`await page.click('text=English')\`
- If a page snapshot shows \`<a href="/about">About Us</a>\`, use exactly: \`page.click('a[href="/about"]')\`
- If a snapshot shows \`<input name="email" type="email" placeholder="you@example.com" />\`, use exactly: \`page.fill('input[name="email"]', 'test@example.com')\`

═══ CHECKBOXES, RADIOS & TOGGLES ═══
- Snapshots show checkbox/radio state: \`checked\` or \`unchecked\`, plus their associated label text in a \`<!-- label: ... -->\` comment.
- ALWAYS use the checkbox id as selector (most reliable): \`await page.check('#blog_published')\`
- If no id, use BOTH type and name: \`await page.check('input[type="checkbox"][name="blog[published]"]')\`
- NEVER select checkboxes by name alone (\`input[name="..."]\`) — frameworks like Rails generate a hidden input with the same name that Playwright will match first and fail.
- To uncheck: \`await page.uncheck('#blog_published')\`
- You can also click the label: \`await page.click('label[for="blog_published"]')\` or \`await page.click('text=Published')\`
- ALWAYS prefer \`page.check()\` / \`page.uncheck()\` over \`page.click()\` for checkboxes.

═══ NAVIGATION & LOGIN ═══
- ONLY use routes you have verified in the routes file or that are visible as \`<a href="...">\` links in the page snapshots. NEVER guess, infer, or invent URLs.
- Prefer clicking links (\`page.click('a[href="/path"]')\`) over \`page.goto()\` — clicking a real link guarantees the route exists.
- When using \`page.goto('${previewUrl}/path')\`, the path MUST come from the routes file or a snapshot link.
- After form submissions, use page.goto() to navigate to the expected destination explicitly.
- Only visit pages that are relevant to the task's changes.
- If the app requires login and LOGIN CREDENTIALS are provided above, log in FIRST:
  1. Look at the login page snapshot for the exact form field names/types
  2. Fill each field using the exact selector from the snapshot and the exact credential values provided
  3. Click the submit button using the exact text from the snapshot
  4. Wait for navigation: \`await page.waitForTimeout(1500)\`
  5. Then navigate to the authenticated pages

═══ TIMING ═══
- Use \`await page.waitForSelector('selector', { timeout: 5000 })\` after actions that change the page (navigation, form submit, dynamic content).
- Use \`await page.waitForTimeout(1500)\` for visual pauses between demo steps.
- Do NOT use waitForTimeout > 3000ms — use waitForSelector instead.

═══ RULES ═══
- No try/catch, require, import, page declaration, waitForNavigation, locator, page.locator().
- NEVER use Playwright locator-only pseudo-selectors: \`:has-text()\`, \`:has()\`, \`:is()\`, \`:nth-match()\`. These only work with \`page.locator()\` and will FAIL with \`page.click()\`.
- ALLOWED: click, fill, goto, waitForSelector, waitForTimeout, evaluate, selectOption, check, uncheck, press.
- Complete full workflows only when the task involves creating a feature with forms/CRUD.
- Scroll content-heavy pages: \`await page.evaluate(() => window.scrollBy(0, 300));\`

═══ VOICE NARRATION ═══
Add \`// NARRATE: ...\` comments before major steps:
- Start with a NARRATE introducing the app/feature
- Add NARRATE before each key interaction
- Every NARRATE MUST be immediately followed by the Playwright code performing the action
- 1 short sentence, present tense
- Add waitForTimeout(1500-2500) after narrated actions

Example:
  // NARRATE: Here's a recipe sharing app where users can create and browse recipes
  await page.waitForTimeout(2000);

  // NARRATE: Let's navigate to the recipes page
  await page.goto('${previewUrl}/recipes');
  await page.waitForSelector('h1', { timeout: 5000 });
  await page.waitForTimeout(1500);

  // NARRATE: We can create a new recipe using this form
  await page.click('a[href="/recipes/new"]');
  await page.waitForSelector('input[name="title"]', { timeout: 5000 });
  await page.fill('input[name="title"]', 'Chocolate Cake');
  await page.waitForTimeout(1500);

═══ OUTPUT FORMAT — CRITICAL ═══
- Your ENTIRE response must be executable JavaScript code. Nothing else.
- Do NOT include any explanation, description, summary, or commentary before or after the code.
- Do NOT write the script to any file. Do NOT use the Write tool or bash to create files. Just return the code as your response text.
- The ONLY comments allowed are \`// NARRATE: ...\` lines.
- No markdown fences, no bullet points, no "This script does X" summaries.
- If you include ANY non-JavaScript text, the video recording will fail.

Return ONLY JavaScript code.`;
}

// ── Walkthrough step (live, one step at a time) ───────────────────────

interface WalkthroughStepPromptParams {
  goal: string;
  appName: string;
  appDescription?: string;
  contextSection: string;
  historyText: string;
  currentPath: string;
  viewportWidth: number;
  viewportHeight: number;
  pageSnapshot: string;
}

export function buildWalkthroughStepPrompt({
  goal,
  appName,
  appDescription,
  contextSection,
  historyText,
  currentPath,
  viewportWidth,
  viewportHeight,
  pageSnapshot,
}: WalkthroughStepPromptParams): string {
  return `You are giving a live guided walkthrough of a web app. You execute ONE step at a time.

GOAL: ${goal}
APP: ${appName}
${appDescription ? `DESCRIPTION: ${appDescription}` : ""}
${contextSection}

COMPLETED STEPS:
${historyText}

CURRENT PAGE: ${currentPath}
VIEWPORT: ${viewportWidth}x${viewportHeight}px

PAGE SNAPSHOT (live DOM):
${pageSnapshot}

Return the NEXT step of the walkthrough. Output:
1. A // NARRATE: comment (one natural sentence describing what the viewer is seeing or what you're about to do)
2. 1-4 Playwright actions to execute this step
3. If the walkthrough is complete, add // DONE as the last line

RULES:
- Use \`page\` variable (Playwright Page)
- ALLOWED: click, fill, goto, waitForSelector, waitForTimeout, evaluate
- Use ONLY selectors from the PAGE SNAPSHOT — never guess or invent selectors
- Selector priority:
  1. \`page.click('a[href="/path"]')\` for links (exact href from snapshot)
  2. \`page.click('text=Exact Text')\` for buttons (exact text from snapshot)
  3. \`page.fill('input[name="field"]', 'value')\` for inputs
- NEVER use :has-text(), :has(), >>, or locator-only pseudo-selectors
- For scrolling: \`await page.evaluate(() => document.querySelector('SELECTOR').scrollIntoView({ behavior: "smooth", block: "center" }))\`
- NEVER use pixel-based scrollBy/scrollTo
- Add \`await page.waitForTimeout(1500)\` after actions that change the page
- If the page is empty and you need data, create it by filling forms
- Keep it focused — one logical step per response
- If you've shown everything relevant to the goal, output // DONE

Output ONLY the script lines, no markdown fences or explanation.`;
}

// ── Code walkthrough plan ─────────────────────────────────────────────

interface CodeWalkthroughPlanPromptParams {
  goal: string;
  appName: string;
  taskTitle?: string;
  contextFormatted: string;
  fullDiff: string;
}

export function buildCodeWalkthroughPlanPrompt({
  goal,
  appName,
  taskTitle,
  contextFormatted,
  fullDiff,
}: CodeWalkthroughPlanPromptParams): string {
  return `You are the AI developer who made these code changes. Walk the user through what you did and why, speaking in first person ("I updated...", "I added...", "I refactored...").

GOAL: ${goal}
APP: ${appName}
${taskTitle ? `TASK: ${taskTitle}` : ""}

${contextFormatted ? contextFormatted + "\n" : ""}

FULL DIFF:
${fullDiff.slice(0, 30000)}

Return a JSON array (no markdown fences) of walkthrough steps. Each step explains one logical change:

[
  {
    "file": "path/to/file.ts",
    "narration": "One or two sentences explaining what you changed in this file and why, in first person."
  }
]

RULES:
- Speak in first person — you made these changes, own them ("I added...", "I moved...", "I fixed...")
- Group related changes — don't make a step for every single line
- Order steps logically: data model changes first, then business logic, then UI, then tests
- Keep narrations conversational but precise — imagine you're explaining your work to a teammate
- File paths must match exactly what appears in the diff headers
- 3-10 steps total, no more
- Return ONLY the JSON array`;
}

// ── Live walkthrough script (from page snapshot) ──────────────────────

interface LiveWalkthroughPromptParams {
  taskTitle: string;
  taskDescription?: string;
  previewUrl: string;
  currentPath: string;
  viewportWidth: number;
  viewportHeight: number;
  pageSnapshot: string;
}

export function buildLiveWalkthroughPrompt({
  taskTitle,
  taskDescription,
  previewUrl,
  currentPath,
  viewportWidth,
  viewportHeight,
  pageSnapshot,
}: LiveWalkthroughPromptParams): string {
  return `You generate a short Playwright walkthrough script to demo a web app feature.

TASK: ${taskTitle}
${taskDescription ? `Description: ${taskDescription}` : ""}
App URL: ${previewUrl}
Current page: ${currentPath}
Viewport: ${viewportWidth}x${viewportHeight}px

RENDERED PAGE SNAPSHOT (current live state):
${pageSnapshot}

Write a Playwright script (15-40 lines) that gives a guided tour of what was built.
The script will run directly on the user's live preview, not in a headless browser.

RULES:
- Use \`page\` variable (Playwright Page, already on the app)
- ALLOWED: click, fill, goto, waitForSelector, waitForTimeout, evaluate
- Use ONLY selectors from the page snapshot above — never guess
- Selector priority:
  1. \`page.click('a[href="/path"]')\` for links (use exact href from snapshot)
  2. \`page.click('text=Exact Text')\` for buttons/links (use exact text from snapshot)
  3. \`page.fill('input[name="field"]', 'value')\` for form fields
- NEVER use :has-text(), :has(), >>, or locator-only selectors
- For scrolling: use \`await page.evaluate(() => document.querySelector('SELECTOR').scrollIntoView({ behavior: "smooth", block: "center" }))\` to scroll to specific elements — NEVER use pixel-based scrollBy/scrollTo
- Add \`await page.waitForTimeout(1500)\` after significant actions
- Do NOT use waitForTimeout > 3000ms

NARRATION:
- Add \`// NARRATE: ...\` comments before major steps
- Start with a NARRATE introducing what we're looking at
- 1 short sentence per narration, present tense
- Every NARRATE must be immediately followed by the action code

Example:
// NARRATE: Here's the recipe sharing app with a list of published recipes
await page.waitForTimeout(2000);

// NARRATE: Let's click into one of the recipes to see its details
await page.click('a[href="/recipes/1"]');
await page.waitForTimeout(1500);

// NARRATE: We can see the full recipe with ingredients and instructions
await page.evaluate(() => document.querySelector('.ingredients-section').scrollIntoView({ behavior: "smooth", block: "center" }));
await page.waitForTimeout(1500);

Output ONLY the script, no markdown fences or explanation.`;
}
