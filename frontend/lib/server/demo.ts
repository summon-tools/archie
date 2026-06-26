/**
 * Video demo generation module.
 * Uses Playwright to record a headless browser navigating the preview app,
 * with Claude AI generating the navigation script based on task description.
 * Supports optional voice narration via node-edge-tts + ffmpeg.
 */

import fs from "fs";
import path from "path";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { getDb } from "./db";
import { runEphemeralQuery, runToolEnabledStream } from "./sdk-helpers";
import type { ToolActivity } from "./sdk-helpers";
import type { AppRow, DemoStatus } from "./types";
import os from "os";
import type { TechStack } from "./techstack";
import { getWorktreeDatabaseName } from "./techstack";
import { startPreview } from "./worktrees";
import { assembleContext } from "./knowledge/context";
import { SEED_CONTEXT, DEMO_CONTEXT } from "./knowledge/contracts";
import { preflightCheck } from "./knowledge/preflight";
import * as dal from "./dal";
import { buildFixScriptPrompt, buildNavigationScriptPrompt } from "./prompts/demo";

// Compat shim: TaskRow-like interface built from work_item + env + artifacts
interface TaskCompat {
  id: number;
  app_id: number;
  title: string;
  description: string;
  worktree_dir: string | null;
  preview_port: number | null;
  preview_pid: number | null;
  demo_video_path: string | null;
  demo_status: DemoStatus;
  demo_error: string | null;
  demo_seed_script: string | null;
  demo_seed_output: string | null;
  demo_seed_status: string | null;
  demo_script: string | null;
  demo_personas: string | null;
  walkthrough_script: string | null;
}

function loadTaskCompat(workItemId: number): TaskCompat | undefined {
  const wi = dal.getWorkItem(workItemId);
  if (!wi) return undefined;
  const env = dal.getWorkItemEnv(workItemId);
  const videoArt = dal.getArtifactByKind(workItemId, "demo_video");
  const scriptArt = dal.getArtifactByKind(workItemId, "demo_script");
  const walkthroughArt = dal.getArtifactByKind(workItemId, "walkthrough_script");
  const seedArt = dal.getArtifactByKind(workItemId, "demo_seed");
  const personasArt = dal.getArtifactByKind(workItemId, "demo_personas");

  let seedMeta: any = {};
  if (seedArt?.metadata_json) { try { seedMeta = JSON.parse(seedArt.metadata_json); } catch {} }

  return {
    id: workItemId,
    app_id: wi.app_id,
    title: wi.title,
    description: wi.summary,
    worktree_dir: env?.worktree_dir || null,
    preview_port: env?.preview_port || null,
    preview_pid: env?.preview_pid || null,
    demo_video_path: videoArt?.file_path || null,
    demo_status: (seedMeta?.demo_status as DemoStatus) || null,
    demo_error: seedMeta?.demo_error || null,
    demo_seed_script: seedArt?.inline_text || null,
    demo_seed_output: seedMeta?.output || null,
    demo_seed_status: seedMeta?.status || null,
    demo_script: scriptArt?.inline_text || null,
    demo_personas: personasArt?.inline_text || null,
    walkthrough_script: walkthroughArt?.inline_text || null,
  };
}

// Kept as TaskRow alias for the few places that cast db results
type TaskRow = TaskCompat;

/** Get seed_script for an app from app_tool_configs */
function getAppSeedScript(appId: number): string | null {
  const config = dal.getAppToolConfig(appId, "seed");
  if (!config) return null;
  try { return JSON.parse(config).script || null; } catch { return null; }
}

/** Get TTS voice for an app (stored in app_tool_configs) */
function getAppTtsVoice(appId: number): string {
  const config = dal.getAppToolConfig(appId, "tts");
  if (!config) return "en-US-AndrewNeural";
  try { return JSON.parse(config).voice || "en-US-AndrewNeural"; } catch { return "en-US-AndrewNeural"; }
}

const execFileAsync = promisify(execFile);

// In-memory tracking of active demo jobs.
// Stored on globalThis so hot-reload in dev mode doesn't orphan references.
const _demoJobs: Map<number, { abort: AbortController }> =
  (globalThis as any).__demoJobs ??= new Map();

/** Resolve the demo directory inside the task's worktree. */
function getDemoDir(worktreeDir: string): string {
  return path.join(worktreeDir, ".archie", "videos");
}

/**
 * Get the git diff for a worktree (shows what code was actually written).
 * Focuses on page/route/component files that reveal app workflows.
 */
export function getWorktreeCodeDiff(worktreeDir: string): string {
  try {
    const diff = execSync(
      "git diff main --no-color -- '*.tsx' '*.ts' '*.jsx' '*.js' ':!node_modules' ':!*.config.*' ':!*.lock'",
      { cwd: worktreeDir, encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 5000 }
    );
    if (diff.trim()) return diff;

    return execSync(
      "git diff HEAD~1 --no-color -- '*.tsx' '*.ts' '*.jsx' '*.js' ':!node_modules' ':!*.config.*' ':!*.lock'",
      { cwd: worktreeDir, encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 5000 }
    );
  } catch {
    return "";
  }
}

/** Update demo state for a work item (stored in artifacts metadata). */
/** Update demo-related artifacts. Returns the new video artifact ID if a video was saved. */
function updateTaskDemo(workItemId: number, fields: Record<string, unknown>): number | undefined {
  const wi = dal.getWorkItem(workItemId);
  if (!wi) return undefined;
  let videoArtifactId: number | undefined;

  // demo_status and demo_error are stored in the demo_seed artifact's metadata
  if (fields.demo_status !== undefined || fields.demo_error !== undefined) {
    const seedArt = dal.getArtifactByKind(workItemId, "demo_seed");
    let meta: any = {};
    if (seedArt?.metadata_json) { try { meta = JSON.parse(seedArt.metadata_json); } catch {} }
    if (fields.demo_status !== undefined) meta.demo_status = fields.demo_status;
    if (fields.demo_error !== undefined) meta.demo_error = fields.demo_error;
    if (seedArt) {
      getDb().prepare("UPDATE artifacts SET metadata_json = ? WHERE id = ?").run(JSON.stringify(meta), seedArt.id);
    } else {
      dal.createArtifact({
        app_id: wi.app_id,
        work_item_id: workItemId,
        kind: "demo_seed",
        name: "Demo Seed",
        storage_type: "inline",
        metadata_json: JSON.stringify(meta),
      });
    }
  }

  // demo_video_path stored in demo_video artifact.
  // We keep old artifacts so previous video messages in conversation remain playable.
  if (fields.demo_video_path !== undefined && fields.demo_video_path) {
    const art = dal.createArtifact({
      app_id: wi.app_id,
      work_item_id: workItemId,
      kind: "demo_video",
      name: "Demo Video",
      storage_type: "file",
      file_path: fields.demo_video_path as string,
    });
    videoArtifactId = art.id;
  }

  // demo_seed_script, demo_seed_output, demo_seed_status stored in demo_seed artifact
  if (fields.demo_seed_script !== undefined || fields.demo_seed_output !== undefined || fields.demo_seed_status !== undefined) {
    const seedArt = dal.getArtifactByKind(workItemId, "demo_seed");
    let meta: any = {};
    if (seedArt?.metadata_json) { try { meta = JSON.parse(seedArt.metadata_json); } catch {} }
    if (fields.demo_seed_output !== undefined) meta.output = fields.demo_seed_output;
    if (fields.demo_seed_status !== undefined) meta.status = fields.demo_seed_status;
    if (seedArt) {
      const updates: any = { metadata_json: JSON.stringify(meta) };
      if (fields.demo_seed_script !== undefined) {
        getDb().prepare("UPDATE artifacts SET inline_text = ?, metadata_json = ? WHERE id = ?").run(
          fields.demo_seed_script as string ?? null, JSON.stringify(meta), seedArt.id
        );
      } else {
        getDb().prepare("UPDATE artifacts SET metadata_json = ? WHERE id = ?").run(JSON.stringify(meta), seedArt.id);
      }
    } else {
      dal.createArtifact({
        app_id: wi.app_id,
        work_item_id: workItemId,
        kind: "demo_seed",
        name: "Demo Seed",
        storage_type: "inline",
        inline_text: (fields.demo_seed_script as string) ?? null,
        metadata_json: JSON.stringify(meta),
      });
    }
  }

  // demo_script stored in demo_script artifact
  if (fields.demo_script !== undefined) {
    dal.deleteArtifactsByKind(workItemId, "demo_script");
    if (fields.demo_script) {
      dal.createArtifact({
        app_id: wi.app_id,
        work_item_id: workItemId,
        kind: "demo_script",
        name: "Demo Script",
        storage_type: "inline",
        inline_text: fields.demo_script as string,
      });
    }
  }

  // walkthrough_script stored in walkthrough_script artifact
  if (fields.walkthrough_script !== undefined) {
    dal.deleteArtifactsByKind(workItemId, "walkthrough_script");
    if (fields.walkthrough_script) {
      dal.createArtifact({
        app_id: wi.app_id,
        work_item_id: workItemId,
        kind: "walkthrough_script",
        name: "Walkthrough Script",
        storage_type: "inline",
        inline_text: fields.walkthrough_script as string,
      });
    }
  }

  // demo_personas stored in demo_personas artifact
  if (fields.demo_personas !== undefined) {
    dal.deleteArtifactsByKind(workItemId, "demo_personas");
    if (fields.demo_personas) {
      dal.createArtifact({
        app_id: wi.app_id,
        work_item_id: workItemId,
        kind: "demo_personas",
        name: "Demo Personas",
        storage_type: "inline",
        inline_text: fields.demo_personas as string,
      });
    }
  }

  return videoArtifactId;
}

/**
 * JS snippet evaluated inside Playwright to extract a compact representation
 * of all interactive and structural elements on the current page.
 * Returns a structured text snapshot Claude can use to write accurate selectors.
 */
const PAGE_SNAPSHOT_JS = `(() => {
  const items = [];

  // Headings — provide page structure context
  document.querySelectorAll("h1, h2, h3").forEach(el => {
    const text = el.innerText?.trim();
    if (text) items.push("<" + el.tagName.toLowerCase() + ">" + text + "</" + el.tagName.toLowerCase() + ">");
  });

  // Links
  document.querySelectorAll("a[href]").forEach(el => {
    const href = el.getAttribute("href") || "";
    const text = el.innerText?.trim().slice(0, 80) || "";
    if (!href || href.startsWith("javascript:")) return;
    items.push('<a href="' + href + '">' + text + '</a>');
  });

  // Buttons
  document.querySelectorAll("button, [role='button']").forEach(el => {
    const text = el.innerText?.trim().slice(0, 80) || "";
    const type = el.getAttribute("type") || "";
    const disabled = el.hasAttribute("disabled") ? " disabled" : "";
    items.push("<button" + (type ? ' type="' + type + '"' : "") + disabled + ">" + text + "</button>");
  });

  // Form inputs (with labels, checked state, and id for label association)
  // Skip hidden inputs — they are Rails/framework internals, not user-interactable
  document.querySelectorAll("input, textarea, select").forEach(el => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "hidden") return;
    const id = el.getAttribute("id") || "";
    const name = el.getAttribute("name") || "";
    const placeholder = el.getAttribute("placeholder") || "";
    const ariaLabel = el.getAttribute("aria-label") || "";
    const checked = (type === "checkbox" || type === "radio") ? el.checked : null;

    // Find associated label text
    let labelText = "";
    if (id) {
      const labelEl = document.querySelector('label[for="' + id + '"]');
      if (labelEl) labelText = labelEl.innerText?.trim().slice(0, 80) || "";
    }
    if (!labelText) {
      // Check for wrapping label
      const parentLabel = el.closest("label");
      if (parentLabel) labelText = parentLabel.innerText?.trim().slice(0, 80) || "";
    }

    let desc = "<" + tag;
    if (id) desc += ' id="' + id + '"';
    if (name) desc += ' name="' + name + '"';
    if (type) desc += ' type="' + type + '"';
    if (placeholder) desc += ' placeholder="' + placeholder + '"';
    if (ariaLabel) desc += ' aria-label="' + ariaLabel + '"';
    if (checked === true) desc += " checked";
    if (checked === false) desc += " unchecked";
    if (tag === "select") {
      const opts = [];
      el.querySelectorAll("option").forEach(o => opts.push(o.textContent?.trim()));
      desc += ">" + opts.filter(Boolean).join(" | ") + "</select>";
    } else {
      desc += " />";
    }
    if (labelText) desc += " <!-- label: " + labelText + " -->";
    items.push(desc);
  });

  // Standalone labels (for custom checkbox/toggle components)
  document.querySelectorAll("label").forEach(el => {
    const forAttr = el.getAttribute("for") || "";
    const text = el.innerText?.trim().slice(0, 80) || "";
    if (!text) return;
    // Skip if already captured via input association above
    if (forAttr && document.querySelector("#" + CSS.escape(forAttr))) return;
    if (el.querySelector("input")) return;
    items.push('<label' + (forAttr ? ' for="' + forAttr + '"' : '') + '>' + text + '</label>');
  });

  // Nav elements (summarized)
  document.querySelectorAll("nav").forEach(el => {
    const links = [];
    el.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href") || "";
      const text = a.innerText?.trim().slice(0, 40) || "";
      if (href && text) links.push(text + " -> " + href);
    });
    if (links.length > 0) items.push("<nav>\\n  " + links.join("\\n  ") + "\\n</nav>");
  });

  return items.join("\\n");
})()`;

interface PageSnapshot {
  url: string;
  path: string;
  snapshot: string;
}

interface AppCredentials {
  email?: string;
  username?: string;
  password?: string;
}

interface DemoPersona {
  name: string;
  email?: string;
  username?: string;
  password?: string;
}

/**
 * Discover internal links from the current page.
 */
async function discoverLinks(page: any): Promise<string[]> {
  return page.evaluate(() => {
    const hrefs = new Set<string>();
    document.querySelectorAll("a[href]").forEach((a: Element) => {
      const href = a.getAttribute("href") || "";
      if (href.startsWith("/") && !href.startsWith("/_") && !href.startsWith("/api")
          && !href.match(/\.(js|css|ico|png|jpg|svg|woff|ttf)$/)) {
        hrefs.add(href.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/");
      }
    });
    return Array.from(hrefs);
  });
}

/**
 * Click potential dropdown triggers on the page, snapshot any newly revealed
 * menus / listboxes / popovers, then close them again.  Returns a string of
 * <!-- DROPDOWN --> blocks to append to the static page snapshot.
 */
async function expandDropdowns(page: any): Promise<string> {
  // Collect candidate triggers inside the page
  const candidates: { index: number; text: string }[] = await page.evaluate(() => {
    const results: { index: number; text: string }[] = [];
    const seen = new Set<Element>();
    // Explicit ARIA dropdown triggers
    document.querySelectorAll("[aria-haspopup], [aria-expanded], [data-toggle='dropdown']").forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);
      const text = (el as HTMLElement).innerText?.trim().slice(0, 40) || "";
      results.push({ index: results.length, text });
    });
    // Short-text buttons that aren't submit/form buttons
    document.querySelectorAll("button, [role='button']").forEach(el => {
      if (seen.has(el)) return;
      const text = (el as HTMLElement).innerText?.trim().slice(0, 40) || "";
      if (!text || text.length > 20) return;
      const type = el.getAttribute("type") || "";
      if (type === "submit" || type === "reset") return;
      if (el.closest("form")) return;
      if (el.closest("a")) return;
      seen.add(el);
      results.push({ index: results.length, text });
    });
    return results.slice(0, 5);
  });

  if (candidates.length === 0) return "";

  const sections: string[] = [];

  for (const cand of candidates) {
    try {
      // Re-query the element by its index among the same selector set
      const triggerHandle = await page.evaluateHandle((idx: number) => {
        const seen = new Set<Element>();
        const all: Element[] = [];
        document.querySelectorAll("[aria-haspopup], [aria-expanded], [data-toggle='dropdown']").forEach(el => {
          if (!seen.has(el)) { seen.add(el); all.push(el); }
        });
        document.querySelectorAll("button, [role='button']").forEach(el => {
          if (seen.has(el)) return;
          const text = (el as HTMLElement).innerText?.trim().slice(0, 40) || "";
          if (!text || text.length > 20) return;
          const type = el.getAttribute("type") || "";
          if (type === "submit" || type === "reset") return;
          if (el.closest("form") || el.closest("a")) return;
          seen.add(el);
          all.push(el);
        });
        return all[idx] || null;
      }, cand.index);

      if (!triggerHandle) continue;

      // Count elements before click
      const beforeCount: number = await page.evaluate(() => document.querySelectorAll("*").length);

      await triggerHandle.click();
      await page.waitForTimeout(300);

      // Snapshot any newly appeared dropdown content
      const dropdownContent: string = await page.evaluate((before: number) => {
        // Look for common dropdown containers
        const selectors = [
          "[role='menu']", "[role='listbox']", "[role='dialog']",
          ".dropdown-menu", ".popover", "[data-radix-popper-content-wrapper]",
          "[data-state='open']"
        ];
        const containers: Element[] = [];
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => containers.push(el));
        }

        // Also check if element count grew significantly (generic dropdown)
        const afterCount = document.querySelectorAll("*").length;
        const grew = afterCount > before + 2;

        if (containers.length === 0 && !grew) return "";

        // Snapshot the dropdown items
        const items: string[] = [];
        const seen = new Set<string>();
        for (const c of containers) {
          c.querySelectorAll("a, button, [role='menuitem'], [role='option'], li").forEach(el => {
            const tag = el.tagName.toLowerCase();
            const text = (el as HTMLElement).innerText?.trim().slice(0, 80) || "";
            if (!text || seen.has(text)) return;
            seen.add(text);
            const href = el.getAttribute("href");
            if (href) {
              items.push('<a href="' + href + '">' + text + '</a>');
            } else {
              items.push('<' + tag + '>' + text + '</' + tag + '>');
            }
          });
        }
        return items.join("\n");
      }, beforeCount);

      // Close the dropdown
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      if (dropdownContent.trim()) {
        sections.push(`<!-- DROPDOWN: "${cand.text}" -->\n${dropdownContent}\n<!-- /DROPDOWN -->`);
      }
    } catch {
      // One trigger failing shouldn't block others — press Escape just in case
      try { await page.keyboard.press("Escape"); } catch {}
    }
  }

  return sections.join("\n\n");
}

/**
 * Crawl the app with Playwright (no video) to collect real rendered DOM snapshots.
 * Auth-aware: detects login forms and attempts to log in with extracted credentials.
 */
async function crawlAppPages(
  previewUrl: string,
  signal: AbortSignal,
  creds?: AppCredentials
): Promise<PageSnapshot[]> {
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const pages: PageSnapshot[] = [];
  const visited = new Set<string>();
  const baseOrigin = new URL(previewUrl).origin;

  try {
    // Visit homepage
    await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(500);

    // Snapshot the page BEFORE login (captures login form structure if present)
    let preLoginSnapshot = await page.evaluate(PAGE_SNAPSHOT_JS) as string;
    const preLoginDropdowns = await expandDropdowns(page);
    if (preLoginDropdowns) preLoginSnapshot += "\n\n" + preLoginDropdowns;
    const preLoginPath = new URL(page.url()).pathname || "/";

    // Check if we landed on a login page and have credentials
    const didLogin = await attemptLoginIfNeeded(page, creds);

    if (didLogin) {
      // Include the login page snapshot so Claude can write login steps
      pages.push({ url: previewUrl, path: preLoginPath + " (login page)", snapshot: preLoginSnapshot });

      // Snapshot the post-login page (dashboard, home, etc.)
      let postLoginSnapshot = await page.evaluate(PAGE_SNAPSHOT_JS) as string;
      const postLoginDropdowns = await expandDropdowns(page);
      if (postLoginDropdowns) postLoginSnapshot += "\n\n" + postLoginDropdowns;
      const postLoginPath = new URL(page.url()).pathname || "/";
      pages.push({ url: page.url(), path: postLoginPath, snapshot: postLoginSnapshot });
      visited.add(postLoginPath);
      visited.add(preLoginPath);
    } else {
      // No login needed — just capture the homepage
      pages.push({ url: page.url(), path: preLoginPath, snapshot: preLoginSnapshot });
      visited.add(preLoginPath);
    }

    // Discover links and crawl pages
    const links = await discoverLinks(page);
    const toVisit = links.filter((l) => !visited.has(l)).slice(0, 10);

    for (const href of toVisit) {
      if (signal.aborted) break;
      visited.add(href);

      try {
        await page.goto(`${baseOrigin}${href}`, { waitUntil: "domcontentloaded", timeout: 10000 });
        await page.waitForTimeout(300);

        // Check if we got redirected to login (session expired or auth required)
        const currentPath = new URL(page.url()).pathname;
        const hasPasswordField = await page.evaluate(() =>
          !!document.querySelector('input[type="password"]')
        );
        if (hasPasswordField && creds?.password) {
          await attemptLoginIfNeeded(page, creds);
          // Re-navigate to the intended page after login
          await page.goto(`${baseOrigin}${href}`, { waitUntil: "domcontentloaded", timeout: 10000 });
          await page.waitForTimeout(300);
        }

        let snapshot = await page.evaluate(PAGE_SNAPSHOT_JS) as string;
        const dropdowns = await expandDropdowns(page);
        if (dropdowns) snapshot += "\n\n" + dropdowns;
        if (snapshot.trim()) {
          pages.push({ url: `${baseOrigin}${href}`, path: href, snapshot });
        }

        // Discover deeper links
        const subLinks = await discoverLinks(page);
        for (const sub of subLinks) {
          if (!visited.has(sub) && toVisit.length < 14) {
            visited.add(sub);
            toVisit.push(sub);
          }
        }
      } catch {
        // Skip pages that fail to load
      }
    }
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  return pages;
}

/**
 * Detect a login form on the current page and attempt to fill it with credentials.
 * Returns true if login was attempted, false if no login form was found.
 */
async function attemptLoginIfNeeded(page: any, creds?: AppCredentials): Promise<boolean> {
  if (!creds?.password) return false;

  // Check if page has a password input (login form indicator)
  const hasLoginForm = await page.evaluate(() =>
    !!document.querySelector('input[type="password"]')
  );
  if (!hasLoginForm) return false;

  // Get all form field details for robust filling
  const formInfo = await page.evaluate(() => {
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;
    if (!passwordInput) return null;

    // Find the form containing the password field, or the closest container
    const form = passwordInput.closest("form") || passwordInput.closest("div") || document.body;

    // Find ALL input fields that could be identity fields (email, username, text)
    // Collect all non-password, non-hidden inputs
    const allInputs = Array.from(form.querySelectorAll("input")).filter((inp: HTMLInputElement) => {
      const type = (inp.getAttribute("type") || "text").toLowerCase();
      return type !== "password" && type !== "hidden" && type !== "submit" && type !== "button" && type !== "checkbox" && type !== "radio";
    });

    const identityFields = allInputs.map((inp: HTMLInputElement) => ({
      name: inp.getAttribute("name") || "",
      id: inp.getAttribute("id") || "",
      type: (inp.getAttribute("type") || "text").toLowerCase(),
      placeholder: inp.getAttribute("placeholder") || "",
    }));

    const passwordField = {
      name: passwordInput.getAttribute("name") || "",
      id: passwordInput.getAttribute("id") || "",
    };

    // Find submit button — try multiple strategies
    const submitCandidates = [
      form.querySelector('button[type="submit"]'),
      form.querySelector('input[type="submit"]'),
      ...Array.from(form.querySelectorAll("button")).filter((b: HTMLButtonElement) => {
        const text = b.textContent?.toLowerCase() || "";
        return text.match(/log\s*in|sign\s*in|submit|enter|go/);
      }),
      form.querySelector("button"),
    ].filter(Boolean);

    const submitBtn = submitCandidates[0] as HTMLElement | null;

    return {
      identityFields,
      passwordField,
      submitText: submitBtn?.textContent?.trim() || "",
      submitType: submitBtn?.tagName?.toLowerCase() || "",
    };
  });

  if (!formInfo) return false;

  try {
    // Fill identity fields
    for (const field of formInfo.identityFields) {
      const selector = field.name
        ? `input[name="${field.name}"]`
        : field.id
          ? `#${field.id}`
          : field.type === "email"
            ? 'input[type="email"]'
            : `input[placeholder="${field.placeholder}"]`;

      // Determine the right value based on field type/name/placeholder
      const isEmailField = field.type === "email"
        || field.name.toLowerCase().includes("email")
        || field.placeholder.toLowerCase().includes("email");

      const value = isEmailField
        ? (creds.email || creds.username || "admin@example.com")
        : (creds.username || creds.email || "admin");

      await page.fill(selector, value);
    }

    // Fill password
    const pwSelector = formInfo.passwordField.name
      ? `input[name="${formInfo.passwordField.name}"]`
      : formInfo.passwordField.id
        ? `#${formInfo.passwordField.id}`
        : 'input[type="password"]';
    await page.fill(pwSelector, creds.password);

    await page.waitForTimeout(300);

    // Submit — try clicking the button first, fall back to pressing Enter
    let submitted = false;
    if (formInfo.submitText) {
      try {
        // Try exact text match first
        await page.click(`text=${formInfo.submitText}`, { timeout: 2000 });
        submitted = true;
      } catch {
        // Try common login button texts
        for (const text of ["Log in", "Login", "Sign in", "Sign In", "Submit"]) {
          try {
            await page.click(`text=${text}`, { timeout: 1000 });
            submitted = true;
            break;
          } catch {}
        }
      }
    }
    if (!submitted) {
      // Fall back to pressing Enter on the password field
      await page.press(pwSelector, "Enter");
    }

    // Wait for navigation after login
    await page.waitForTimeout(2000);
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    return true;
  } catch {
    return false;
  }
}

/**
 * Ask Claude to generate a Playwright navigation script for the given task.
 * Uses real rendered DOM snapshots from a Playwright crawl for accurate selectors.
 */
/**
 * Strip non-JavaScript content from the model's script output.
 * The model sometimes appends explanatory text after the code.
 */
function cleanScriptOutput(raw: string): string {
  // Strip markdown fences
  let text = raw.replace(/^```(?:javascript|js)?\n?/m, "").replace(/\n?```$/m, "").trim();

  // If the output contains a code block, extract just the code
  const codeBlockMatch = text.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // Strip trailing non-code text: find the last line that looks like JS code
  // (starts with await, //, }, or is empty) and drop everything after non-code lines
  const lines = text.split("\n");
  let lastCodeLine = lines.length - 1;
  // Walk backwards to find where the code ends
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (
      trimmed === "" ||
      trimmed.startsWith("await ") ||
      trimmed.startsWith("// NARRATE:") ||
      trimmed.startsWith("}") ||
      trimmed.startsWith("});") ||
      trimmed.startsWith("const ") ||
      trimmed.startsWith("let ") ||
      trimmed.startsWith("if ") ||
      trimmed.startsWith("for ") ||
      trimmed.startsWith("else")
    ) {
      lastCodeLine = i;
      break;
    }
  }

  return lines.slice(0, lastCodeLine + 1).join("\n").trim();
}

/**
 * Ask Claude to fix a broken demo script based on the errors that occurred during recording.
 * Returns the fixed script, or the original if fixing fails.
 */
async function fixBrokenScript(
  originalScript: string,
  errors: string[],
  pageSnapshot: string,
  worktreeDir?: string,
): Promise<string> {
  const prompt = buildFixScriptPrompt({ originalScript, errors, pageSnapshot });

  try {
    const text = await runEphemeralQuery(prompt, {
      category: "demo",
      maxTurns: 1,
    });
    const fixed = cleanScriptOutput(text);
    // Basic sanity check — fixed script should contain at least one await
    if (fixed.includes("await ")) return fixed;
  } catch {}
  return originalScript;
}

export async function generateNavigationScript(
  taskTitle: string,
  taskDescription: string,
  previewUrl: string,
  signal: AbortSignal,
  context?: { reflectionMessages?: { role: string; content: string }[]; credentials?: AppCredentials; personas?: DemoPersona[]; chatMessages?: string; worktreeDir?: string; appId?: number },
  onActivity?: (event: ToolActivity) => void
): Promise<string> {

  // Use provided credentials for auth-aware crawling
  // Prefer first persona's credentials if available
  const firstPersona = context?.personas?.[0];
  const creds: AppCredentials = firstPersona
    ? { email: firstPersona.email, username: firstPersona.username, password: firstPersona.password }
    : (context?.credentials || {});

  // Crawl the live app with Playwright to get real rendered DOM snapshots
  const pageSnapshots = await crawlAppPages(previewUrl, signal, creds);

  // Format crawl results for the prompt
  let crawlContext = "";
  if (pageSnapshots.length > 0) {
    const formattedPages = pageSnapshots.map((p) =>
      `═══ PAGE: ${p.path} (${p.url}) ═══\n${p.snapshot}`
    ).join("\n\n");
    crawlContext = `\n\n═══ RENDERED PAGE SNAPSHOTS (for selector accuracy) ═══\nCrawled with a real browser — these are the actual elements on each page after JavaScript has executed:\n${formattedPages}`;
  }

  // Build credentials/personas context for the prompt
  let credsContext = "";
  if (context?.personas && context.personas.length > 0) {
    credsContext = `\n\n═══ PERSONAS ═══`;
    for (const p of context.personas) {
      credsContext += `\n- ${p.name}:`;
      if (p.email) credsContext += ` email=${p.email}`;
      if (p.username) credsContext += ` username=${p.username}`;
      if (p.password) credsContext += ` password=${p.password}`;
    }
    credsContext += `\n\nYou can use \`await loginAs("${context.personas[0].name}")\` to log in as a specific persona.`;
    credsContext += `\nloginAs() clears cookies, navigates to /, and fills the login form with the persona's credentials.`;
    credsContext += `\nUse loginAs() for switching between users. For the initial login, you can also fill the form manually.`;
  } else if (creds.password) {
    credsContext = `\n\n═══ LOGIN CREDENTIALS ═══`;
    if (creds.email) credsContext += `\nEmail: ${creds.email}`;
    if (creds.username) credsContext += `\nUsername: ${creds.username}`;
    credsContext += `\nPassword: ${creds.password}`;
    credsContext += `\nUse these exact credentials if the app requires login. The login page snapshot shows the form fields.`;
  }

  // Build additional context (chat messages only — lightweight)
  let additionalContext = "";
  if (context?.chatMessages) {
    additionalContext += `\n\n═══ CHAT HISTORY (all requests made during this task) ═══\n${context.chatMessages}`;
  }

  const worktreeDir = context?.worktreeDir;

  // Inject context for demo script generation via context assembler
  let contextSection = "";
  if (worktreeDir && context?.appId) {
    try {
      const ctx = await assembleContext({
        appId: context.appId,
        directory: worktreeDir,
        needs: DEMO_CONTEXT,
      });
      if (ctx.formatted) {
        contextSection = `\n\n${ctx.formatted}`;
      }
    } catch {}
  }

  const prompt = buildNavigationScriptPrompt({
    taskTitle,
    taskDescription,
    previewUrl,
    worktreeDir,
    credsContext,
    crawlContext,
    additionalContext,
    contextSection,
  });

  const abortController = new AbortController();
  signal.addEventListener("abort", () => abortController.abort(), { once: true });

  // Use tool-enabled stream so Claude can explore routes, controllers, source code
  if (worktreeDir) {
    const stream = runToolEnabledStream(prompt, {
      category: "demo",
      abortController,
      cwd: worktreeDir,
    });

    let resultText = "";
    for await (const event of stream) {
      if (event.type === "result" && event.resultText) {
        resultText = event.resultText;
      }
      onActivity?.(event);
    }
    return cleanScriptOutput(resultText);
  }

  // Fallback: tool-free if no worktree available
  const text = await runEphemeralQuery(prompt, {
    category: "demo",
    abortController,
  });

  return cleanScriptOutput(text);
}

// --- Demo Data Seeding ---

const MAX_SCHEMA_BYTES = 100 * 1024;

/**
 * Read schema/model files based on the app's framework.
 * Returns concatenated file contents capped at ~30KB.
 */
export function getSchemaFiles(appDir: string, techStack: TechStack): string {
  const patterns: string[][] = [];

  // Helper to recursively collect files with a given extension from a directory
  const collectFiles = (dir: string, ext: string): string[] => {
    const results: string[] = [];
    try {
      if (!fs.existsSync(dir)) return results;
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            walk(path.join(d, entry.name));
          } else if (entry.name.endsWith(ext)) {
            results.push(path.relative(appDir, path.join(d, entry.name)));
          }
        }
      };
      walk(dir);
    } catch {}
    return results;
  };

  switch (techStack.framework) {
    case "rails":
      // Models first — they have enums, validations, and constraints critical for seed generation
      patterns.push(collectFiles(path.join(appDir, "app", "models"), ".rb"));
      // Custom validators (e.g. app/validators/password_complexity_validator.rb)
      patterns.push(collectFiles(path.join(appDir, "app", "validators"), ".rb"));
      // Schema — column types and indexes
      patterns.push(["db/schema.rb"]);
      // Seeds last — can be very large, only included if budget remains
      patterns.push(["db/seeds.rb"]);
      break;

    case "nextjs":
    case "express":
      patterns.push(
        ["prisma/schema.prisma"],
        ["drizzle/schema.ts"],
      );
      // Look for model/schema files in root and src/
      try {
        for (const dir of [appDir, path.join(appDir, "src")]) {
          if (!fs.existsSync(dir)) continue;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isFile() && (entry.name.match(/\.model\.(ts|js)$/) || entry.name === "schema.ts")) {
              patterns.push([path.relative(appDir, path.join(dir, entry.name))]);
            }
          }
        }
      } catch {}
      // Collect validation/middleware files
      patterns.push(collectFiles(path.join(appDir, "src", "validators"), ".ts"));
      patterns.push(collectFiles(path.join(appDir, "src", "middleware"), ".ts"));
      break;

    case "django":
      // Find */models.py, */admin.py, and */validators.py
      try {
        for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            for (const fname of ["models.py", "admin.py", "validators.py"]) {
              const fpath = path.join(entry.name, fname);
              if (fs.existsSync(path.join(appDir, fpath))) {
                patterns.push([fpath]);
              }
            }
          }
        }
      } catch {}
      break;

    case "fastapi":
      patterns.push(
        ["models.py"],
        ["schemas.py"],
        ["database.py"],
        ["db.py"],
        ["app/models.py"],
        ["app/schemas.py"],
        ["app/database.py"],
        ["app/db.py"],
      );
      patterns.push(collectFiles(path.join(appDir, "app", "models"), ".py"));
      patterns.push(collectFiles(path.join(appDir, "app", "schemas"), ".py"));
      patterns.push(collectFiles(path.join(appDir, "src"), ".py"));
      break;

    case "flask":
      patterns.push(
        ["models.py"],
      );
      // Check app/models/ and app/validators/
      patterns.push(collectFiles(path.join(appDir, "app", "models"), ".py"));
      patterns.push(collectFiles(path.join(appDir, "app", "validators"), ".py"));
      break;
  }

  const parts: string[] = [];
  let totalSize = 0;

  for (const group of patterns) {
    if (totalSize >= MAX_SCHEMA_BYTES) break;
    for (const relPath of group) {
      if (totalSize >= MAX_SCHEMA_BYTES) break;
      const fullPath = path.join(appDir, relPath);
      try {
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, "utf-8");
        const remaining = MAX_SCHEMA_BYTES - totalSize;
        const truncated = content.length > remaining
          ? content.slice(0, remaining) + "\n... (truncated)"
          : content;
        parts.push(`═══ ${relPath} ═══\n${truncated}`);
        totalSize += truncated.length;
      } catch {}
    }
  }

  return parts.join("\n\n");
}

/**
 * Load the seed tool file for a given framework.
 * Returns the markdown content or empty string if not found.
 */
export function getSeedTool(framework: string): string {
  const toolPath = path.join(__dirname, "skills/seed", `${framework}.md`);
  try {
    return fs.readFileSync(toolPath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Build the seed generation prompt. Claude will explore the codebase itself using tools.
 */
async function buildSeedPrompt(techStack: TechStack, worktreeDir: string, appId?: number, customInstruction?: string): Promise<string> {
  const seedTool = getSeedTool(techStack.framework);

  let dbContext = `Database: ${techStack.database}`;
  if (techStack.databaseName) {
    dbContext += ` (name: ${techStack.databaseName})`;
  }

  let seedToolContext = "";
  if (seedTool) {
    seedToolContext = `\n\n═══ SEED TOOL (expert patterns for ${techStack.framework}) ═══\n${seedTool}`;
  }

  let customContext = "";
  if (customInstruction) {
    customContext = `\n\n═══ CUSTOM INSTRUCTIONS ═══\n${customInstruction}`;
  }

  // Use context assembler for schema, personas, and codebase knowledge
  let assembledContext = "";
  if (appId) {
    try {
      const ctx = await assembleContext({
        appId,
        directory: worktreeDir,
        needs: SEED_CONTEXT,
      });
      if (ctx.formatted) {
        assembledContext = `\n\n${ctx.formatted}`;
      }
    } catch {}
  }

  return `You generate a bash shell script to seed demo data into a web application's database, AND you generate the personas (user accounts) needed for the demo.

Framework: ${techStack.framework}
${dbContext}
Working directory: ${worktreeDir}
${seedToolContext}
${customContext}
${assembledContext}

EXPLORE THE CODEBASE to understand the data model:
1. Read the schema/model files (e.g., \`db/schema.rb\`, \`prisma/schema.prisma\`, \`*/models.py\`)
2. Read the user/account model for auth, validations, and password requirements
3. Read relevant controllers to check for default scopes and date filtering
4. Check custom validators if referenced in models
5. Focus on models RELEVANT to the task — not every model in the schema

IMPORTANT — DEFAULT SCOPING:
- If controllers filter records by date, ALL seed data MUST use today's date so it appears in the default view
- Use \`Date.today\` / \`Time.now\` in the seed script, NEVER hardcoded past dates
- Also check for user-scoped data (e.g., \`current_user.posts\`) and assign records to the right persona

CRITICAL RULES:
- Only use enum values that are ACTUALLY DEFINED in the model (use symbol names like \`:admin\`, not raw integers)
- Respect format validations (e.g., if phone validates \`/\\A[0-9]*\\z/\`, no "+" or dashes)
- Respect length validations (e.g., \`length: { maximum: 10 }\`)
- For Rails acceptance validators (\`validates :field, acceptance: true\`), set value to \`"1"\` (string), not \`true\`
- Use bang methods (create!, save!, find_or_create_by!) so validation errors surface as exceptions

PERSONA GENERATION RULES:
- Generate 1-3 personas based on what roles/types the app supports
- If the app has roles (admin, member, etc.), create one persona per role
- Use realistic names and emails (e.g., "Alice Johnson", "alice@example.com")
- Use "Password123" as the default password (uppercase P satisfies common complexity validators)
- If there's a stricter password validator, adapt the password accordingly
- Include username only if the User model has a username field

CRITICAL — DO NOT:
- NEVER call db:create, db:drop, db:reset, migrate, or any database management commands
- NEVER set DATABASE_URL, RAILS_ENV, or modify database configuration
- The database already exists and has the correct schema. ONLY insert/upsert data.
- NEVER pass code inline to runners like \`rails runner 'code'\` or \`python -c 'code'\` — write code to a temp file using a heredoc (\`cat > file << 'DELIMITER'\`) and then run the file.

REQUIREMENTS FOR THE SEED SCRIPT:
1. Create user accounts for all generated personas, with proper password hashing
2. Seed compelling demo data (charts, lists, realistic samples, related records)
3. Use the framework's native tools (see seed tool above)
4. Be idempotent (safe to re-run)
5. Keep the script CONCISE — create 3-5 records per model, focus on variety not volume
6. Source environment setup as needed:
   - Ruby: \`export PATH="$HOME/.rbenv/bin:$HOME/.rbenv/shims:$PATH" && eval "$(rbenv init - 2>/dev/null)" || true\`
   - Node: \`export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\`
   - Python: \`source venv/bin/activate 2>/dev/null || true\`

Return your response as a JSON object (no markdown fences, no explanation) with exactly these fields:
- "script": the complete bash seed script starting with #!/bin/bash and set -e
- "personas": an array of persona objects, each with "name" (string, required), "password" (string, required), and optionally "email" (string) and "username" (string)`;
}

/**
 * Build a prompt for adapting an existing base seed script to the current task.
 * Used as a fast path when the app already has a cached seed script.
 * This is a tool-free query — Claude adapts the script without exploring the codebase.
 */
function buildAdaptSeedPrompt(
  techStack: TechStack,
  worktreeDir: string,
  baseScript: string,
  schemaInfo: string,
  customInstruction?: string,
): string {
  const seedTool = getSeedTool(techStack.framework);

  let seedToolContext = "";
  if (seedTool) {
    seedToolContext = `\n\n═══ SEED TOOL (expert patterns for ${techStack.framework}) ═══\n${seedTool}`;
  }

  let customContext = "";
  if (customInstruction) {
    customContext = `\n\n═══ CUSTOM INSTRUCTIONS ═══\n${customInstruction}`;
  }

  return `You adapt an existing seed script for a web application's database. A base script already exists — modify it only as needed for the current task.

Framework: ${techStack.framework}
Database: ${techStack.database}${techStack.databaseName ? ` (name: ${techStack.databaseName})` : ""}
Working directory: ${worktreeDir}
${seedToolContext}
${customContext}

═══ CURRENT DATABASE SCHEMA ═══
${schemaInfo}

═══ BASE SEED SCRIPT (from previous successful run) ═══
${baseScript}

ADAPT THE SCRIPT:
- If the schema has new tables/columns not covered, add seed data for them
- If tables/columns were removed, remove references to them
- If the task requires specific data (e.g., particular dates, amounts, states), adjust accordingly
- Keep existing personas unless the task needs different roles
- Keep the script structure and patterns — only change what's necessary
- Ensure all date-dependent data uses today's date (Date.today / Time.now)

CRITICAL — DO NOT:
- NEVER call db:create, db:drop, db:reset, migrate, or any database management commands
- NEVER set DATABASE_URL, RAILS_ENV, or modify database configuration
- The database already exists with the correct schema. ONLY insert/upsert data.

Return your response as a JSON object (no markdown fences, no explanation) with exactly these fields:
- "script": the complete bash seed script starting with #!/bin/bash and set -e
- "personas": an array of persona objects, each with "name" (string, required), "password" (string, required), and optionally "email" (string) and "username" (string)`;
}

/**
 * Parse a JSON object from text, with fallback regex extraction.
 */
function extractJson<T>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\n?/m, "")
    .replace(/\n?```$/m, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {}

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]) as T;
    } catch {}
  }

  throw new Error("Model did not return valid JSON");
}

export interface SeedEvent {
  type: "activity" | "progress" | "seed_result" | "error";
  activity?: ToolActivity;
  step?: string;
  message?: string;
  attempt?: number;
  maxAttempts?: number;
  script?: string;
  personas?: DemoPersona[];
  seedOutput?: string;
}

/**
 * Generate a seed script using tool-enabled Claude (single-shot).
 * Claude explores the codebase with tools, then generates the script + personas.
 * Retries with error feedback if the seed script fails to execute.
 */
export async function* generateDemoSeedScript(
  task: TaskRow,
  app: AppRow,
  techStack: TechStack,
  signal: AbortSignal,
  customInstruction?: string,
): AsyncGenerator<SeedEvent, void, undefined> {
  const worktreeDir = task.worktree_dir || app.directory;

  // Preflight check
  const preflight = await preflightCheck({
    appId: app.id,
    directory: worktreeDir,
    workflow: "seed",
  });
  if (!preflight.ok) {
    yield { type: "error", error: preflight.blockers.join("; ") } as SeedEvent;
    return;
  }

  const hasBaseScript = !!getAppSeedScript(app.id);

  const MAX_SEED_RETRIES = 3;
  let lastScript = "";
  let lastPersonas: DemoPersona[] = [];
  let lastOutput = "";

  for (let attempt = 0; attempt < MAX_SEED_RETRIES; attempt++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    yield {
      type: "progress",
      step: "seed_generating",
      message: attempt === 0
        ? (hasBaseScript ? "Adapting seed script..." : "Generating seed script...")
        : `Retrying seed script (attempt ${attempt + 1}/${MAX_SEED_RETRIES})...`,
      attempt: attempt + 1,
      maxAttempts: MAX_SEED_RETRIES,
    };

    let resultText = "";

    // Fast path: adapt existing base script without tool use
    if (hasBaseScript && attempt === 0) {
      const schemaInfo = getSchemaFiles(worktreeDir, techStack);
      const prompt = buildAdaptSeedPrompt(techStack, worktreeDir, getAppSeedScript(app.id)!, schemaInfo, customInstruction)
        + `\n\nAdapt the seed script for this task:\n\nTASK: ${task.title}\n${task.description ? `Description: ${task.description}` : ""}`;

      const abortController = new AbortController();
      signal.addEventListener("abort", () => abortController.abort(), { once: true });

      yield { type: "activity", activity: { type: "text", detail: "Adapting existing seed script (fast path)..." } };

      resultText = await runEphemeralQuery(prompt, {
        category: "demo",
        abortController,
      });
    } else {
      // Full path: tool-enabled exploration
      const systemPrompt = await buildSeedPrompt(techStack, worktreeDir, app.id, customInstruction);

      let prompt = `${systemPrompt}\n\nGenerate a seed script and personas for this task:\n\nTASK: ${task.title}\n${task.description ? `Description: ${task.description}` : ""}`;
      if (attempt > 0) {
        prompt += `\n\nPREVIOUS ATTEMPT FAILED with this error:\n${lastOutput.slice(0, 1500)}\n\nFix the script to resolve this error. Pay close attention to the validation error message — it tells you exactly what's wrong. Update the personas if the credentials need to change (e.g., password requirements).`;
      }

      const abortController = new AbortController();
      signal.addEventListener("abort", () => abortController.abort(), { once: true });

      const stream = runToolEnabledStream(prompt, {
        category: "demo",
        abortController,
        cwd: worktreeDir,
      });

      for await (const event of stream) {
        if (event.type === "result" && event.resultText) {
          resultText = event.resultText;
        }
        yield { type: "activity", activity: event };
      }
    }

    const result = extractJson<{ script: string; personas: DemoPersona[] }>(resultText);

    lastScript = (result.script || "").replace(/^```(?:bash|sh)?\n?/m, "").replace(/\n?```$/m, "").trim();
    lastPersonas = result.personas || [];

    // Try executing the seed script
    if (!task.worktree_dir) break;

    yield { type: "progress", step: "seed_executing", message: "Executing seed script..." };
    const seedResult = executeSeedScript(task.worktree_dir, lastScript, techStack);
    lastOutput = seedResult.output;

    if (seedResult.success) {
      yield {
        type: "seed_result",
        step: "seed_done",
        message: "Seed script executed successfully",
        script: lastScript,
        personas: lastPersonas,
        seedOutput: lastOutput,
      };
      return;
    }

    yield {
      type: "progress",
      step: "seed_failed",
      message: `Seed failed (attempt ${attempt + 1}/${MAX_SEED_RETRIES}): ${lastOutput.slice(0, 300)}`,
      attempt: attempt + 1,
      maxAttempts: MAX_SEED_RETRIES,
    };
  }

  // All retries exhausted
  yield {
    type: "error",
    message: `Seed script failed after ${MAX_SEED_RETRIES} attempts: ${lastOutput.slice(0, 500)}`,
    script: lastScript,
    personas: lastPersonas,
    seedOutput: lastOutput,
  };
}

/**
 * Execute a seed script in the worktree directory.
 * Sets up the appropriate environment (nvm, rbenv, etc.) before running.
 */
export function executeSeedScript(
  worktreeDir: string,
  script: string,
  techStack: TechStack
): { success: boolean; output: string } {
  // Build environment setup based on framework
  let envSetup = "";
  if (techStack.bundleManager === "bundle") {
    envSetup += `export PATH="$HOME/.rbenv/bin:$HOME/.rbenv/shims:$PATH" && eval "$(rbenv init - 2>/dev/null)" || true && `;
  }
  if (techStack.packageManager) {
    envSetup += `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && `;
  }

  // Set DATABASE_URL for Prisma/Node apps with PostgreSQL
  // Skip for Rails — it reads database.yml directly (already patched with the worktree DB name)
  if (techStack.database === "postgresql" && techStack.databaseName &&
      techStack.framework !== "rails") {
    const taskIdMatch = worktreeDir.match(/-task-(\d+)\/?$/);
    if (taskIdMatch) {
      const taskId = parseInt(taskIdMatch[1], 10);
      // Guard against double-suffix: databaseName from worktree may already have _task_N
      const baseName = techStack.databaseName.replace(/_task_\d+$/, "");
      const dbName = getWorktreeDatabaseName(baseName, taskId);
      envSetup += `export DATABASE_URL="postgresql://localhost/${dbName}" && `;
    }
  }

  // Write script to a temp file and execute it
  const scriptPath = path.join(worktreeDir, ".archie", "seed.sh");
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  try {
    const output = execSync(
      `${envSetup}cd "${worktreeDir}" && bash "${scriptPath}"`,
      {
        shell: "bash",
        timeout: 30000,
        cwd: worktreeDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, HOME: os.homedir() },
      }
    );
    return { success: true, output: output || "" };
  } catch (e: any) {
    const output = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
    return { success: false, output: output.slice(0, 2000) };
  }
}

interface ClipInfo {
  clipPath: string | null;  // null if TTS failed
  durationMs: number;
}

/**
 * Parse `// NARRATE: ...` comments from a script.
 * Returns the cleaned script with narration markers injected as
 * `__narrate__(index)` calls, plus the narration text segments.
 * Actual timestamps are captured at runtime by the __narrate__ callback.
 */
function parseNarration(script: string): { cleanScript: string; segments: { text: string }[] } {
  const lines = script.split("\n");
  const segments: { text: string }[] = [];
  const cleanLines: string[] = [];

  for (const line of lines) {
    const narrateMatch = line.match(/^\s*\/\/\s*NARRATE:\s*(.+)$/);
    if (narrateMatch) {
      const idx = segments.length;
      segments.push({ text: narrateMatch[1].trim() });
      // Inject a marker call that will record the real timestamp during execution
      cleanLines.push(`await __narrate__(${idx});`);
      continue;
    }

    cleanLines.push(line);
  }

  return { cleanScript: cleanLines.join("\n"), segments };
}

/**
 * Get duration of a media file (audio or video) in milliseconds using ffprobe.
 */
async function getMediaDurationMs(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-show_entries", "format=duration",
    "-of", "csv=p=0", filePath,
  ]);
  return Math.ceil(parseFloat(stdout.trim()) * 1000);
}

/**
 * Pre-generate TTS clips for all narration segments.
 * Returns ClipInfo[] with file paths and measured durations.
 * Per-clip error handling: failed clips get clipPath=null, durationMs=0.
 */
async function generateTTSClips(segments: { text: string }[], tempDir: string, voice: string = "en-US-AndrewNeural"): Promise<ClipInfo[]> {
  const { EdgeTTS } = await import("node-edge-tts");
  const clips: ClipInfo[] = [];

  for (let i = 0; i < segments.length; i++) {
    const clipPath = path.join(tempDir, `narration-${i}.mp3`);
    try {
      const tts = new EdgeTTS({
        voice,
        lang: "en-US",
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      });
      await tts.ttsPromise(segments[i].text, clipPath);
      const durationMs = await getMediaDurationMs(clipPath);
      clips.push({ clipPath, durationMs });
    } catch {
      clips.push({ clipPath: null, durationMs: 0 });
    }
  }

  return clips;
}

/**
 * Assemble pre-generated TTS clips into a single narration audio track,
 * sequenced with silence gaps so each clip starts at its recorded timestamp.
 * Uses ffmpeg concat demuxer (sequential, never overlapping).
 */
async function assembleNarrationAudio(clips: ClipInfo[], timestamps: number[], outputPath: string, tempDir: string): Promise<void> {
  // Filter to only clips that exist and have a matching timestamp
  const validIndices = clips
    .map((c, i) => ({ clip: c, idx: i }))
    .filter(({ clip, idx }) => clip.clipPath !== null && timestamps[idx] !== undefined);

  if (validIndices.length === 0) return;

  if (validIndices.length === 1) {
    const { clip, idx } = validIndices[0];
    const delayMs = timestamps[idx];
    if (delayMs > 0) {
      await execFileAsync("ffmpeg", [
        "-i", clip.clipPath!,
        "-af", `adelay=${delayMs}|${delayMs}`,
        "-y", outputPath,
      ]);
    } else {
      fs.copyFileSync(clip.clipPath!, outputPath);
    }
    return;
  }

  // Build a concat list: [silence gap] [clip] [silence gap] [clip] ...
  // Each clip starts at its recorded timestamp. The gap before clip[i] is:
  //   timestamps[i] - (end time of previous clip)
  const concatEntries: string[] = [];
  let currentTimeMs = 0;

  for (const { clip, idx } of validIndices) {
    const targetStart = timestamps[idx];
    const gapMs = Math.max(0, targetStart - currentTimeMs);

    if (gapMs > 50) {
      const silencePath = path.join(tempDir, `silence-${idx}.mp3`);
      const gapSec = (gapMs / 1000).toFixed(3);
      await execFileAsync("ffmpeg", [
        "-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono`,
        "-t", gapSec, "-c:a", "libmp3lame", "-y", silencePath,
      ]);
      concatEntries.push(`file '${silencePath}'`);
      currentTimeMs += gapMs;
    }

    concatEntries.push(`file '${clip.clipPath!}'`);
    currentTimeMs += clip.durationMs;
  }

  const concatListPath = path.join(tempDir, "concat.txt");
  fs.writeFileSync(concatListPath, concatEntries.join("\n"));

  await execFileAsync("ffmpeg", [
    "-f", "concat", "-safe", "0", "-i", concatListPath,
    "-c:a", "libmp3lame", "-y", outputPath,
  ]);
}

/**
 * Merge a silent video with an audio track into an MP4 using ffmpeg.
 */
async function mergeVideoAudio(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  const ffmpeg = (await import("fluent-ffmpeg")).default;
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .outputOptions(["-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

/**
 * Record a demo video for a task using a provided script. Returns an SSE ReadableStream.
 */
export async function recordDemo(
  taskId: number,
  appId: number,
  script: string
): Promise<ReadableStream<Uint8Array>> {
  if (_demoJobs.has(taskId)) {
    throw new Error(`Demo is already being generated for task ${taskId}`);
  }

  const task = loadTaskCompat(taskId);
  if (!task) throw new Error("Work item not found");

  const app = dal.getApp(appId);
  if (!app) throw new Error("App not found");

  // Require a running preview
  if (!task.preview_port || !task.preview_pid) {
    throw new Error("No preview running. Start a preview first to record a demo.");
  }
  if (!task.worktree_dir) {
    throw new Error("No worktree available for this task.");
  }
  const previewUrl = `http://localhost:${task.preview_port}`;
  const demoDir = getDemoDir(task.worktree_dir);

  const abortController = new AbortController();
  _demoJobs.set(taskId, { abort: abortController });

  updateTaskDemo(taskId, { demo_status: "recording", demo_error: null });

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let controllerOpen = true;
      function sendEvent(event: string, data: Record<string, unknown>) {
        if (!controllerOpen) return;
        try {
          const sseData = JSON.stringify(data);
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${sseData}\n\n`));
        } catch {
          controllerOpen = false;
        }
      }

      // Send SSE comments as keepalive to prevent proxy timeouts
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch {}
      }, 15_000);

      try {
        if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");

        // Verify the preview is actually reachable before recording
        try {
          const healthCheck = await fetch(previewUrl, { signal: AbortSignal.timeout(5000) });
          if (!healthCheck.ok) throw new Error(`Status ${healthCheck.status}`);
        } catch {
          // Preview is down — try to restart it
          sendEvent("progress", { step: "preview", message: "Preview not responding, restarting..." });
          const { detectTechStack } = await import("./techstack");
          const techStack = detectTechStack(task.worktree_dir!);
          const startResult = await startPreview(task.worktree_dir!, task.preview_port!, techStack);
          if (!startResult.success) {
            sendEvent("error", { error: `Preview server failed to start: ${startResult.message}` });
            return;
          }
          dal.updateWorkItemEnv(taskId, { preview_pid: startResult.pid });
        }

        fs.mkdirSync(demoDir, { recursive: true });

        const { chromium } = await import("playwright");

        // Parse personas from task (auto-generated during seed script generation)
        let personas: DemoPersona[] = [];
        if (task.demo_personas) {
          try { personas = JSON.parse(task.demo_personas); } catch {}
        }

        // Helper: create a loginAs function bound to a given browser context + page
        const createLoginAs = (ctx: any, pg: any) => async (name: string) => {
          const persona = personas.find(p => p.name.toLowerCase() === name.toLowerCase());
          if (!persona) throw new Error(`Persona "${name}" not found`);
          await ctx.clearCookies();
          await pg.goto(previewUrl!, { waitUntil: "domcontentloaded", timeout: 15000 });
          await pg.waitForTimeout(500);

          let hasLoginForm = await pg.evaluate(() => !!document.querySelector('input[type="password"]'));

          if (!hasLoginForm) {
            const loginLink = await pg.evaluate(() => {
              const links = Array.from(document.querySelectorAll("a[href]"));
              const match = links.find(a => {
                const href = (a.getAttribute("href") || "").toLowerCase();
                const text = (a.textContent || "").toLowerCase();
                return href.match(/\/(log[-_]?in|sign[-_]?in|auth|session)/) ||
                  text.match(/\b(log\s*in|sign\s*in)\b/);
              });
              return match ? match.getAttribute("href") : null;
            });

            if (loginLink) {
              const url = loginLink.startsWith("http") ? loginLink : `${new URL(pg.url()).origin}${loginLink}`;
              await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
              await pg.waitForTimeout(500);
              hasLoginForm = await pg.evaluate(() => !!document.querySelector('input[type="password"]'));
            }

            if (!hasLoginForm) {
              const commonPaths = ["/login", "/signin", "/sign-in", "/log-in", "/auth/login", "/users/sign_in"];
              for (const p of commonPaths) {
                try {
                  await pg.goto(`${new URL(previewUrl!).origin}${p}`, { waitUntil: "domcontentloaded", timeout: 5000 });
                  await pg.waitForTimeout(300);
                  hasLoginForm = await pg.evaluate(() => !!document.querySelector('input[type="password"]'));
                  if (hasLoginForm) break;
                } catch {}
              }
            }
          }

          const urlBefore = pg.url();
          await attemptLoginIfNeeded(pg, {
            email: persona.email,
            username: persona.username,
            password: persona.password,
          });
          try {
            await pg.waitForURL((url: URL) => url.href !== urlBefore, { timeout: 5000 });
          } catch {}
          await pg.waitForLoadState("domcontentloaded").catch(() => {});
          await pg.waitForTimeout(500);
        };

        // Helper: run a script in a browser and collect errors (no video recording for dry-run)
        const runScriptDryRun = async (scriptCode: string): Promise<{ errors: string[]; pageSnapshot: string }> => {
          const browser = await chromium.launch({ headless: true });
          const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
          const page = await context.newPage();
          const loginAs = createLoginAs(context, page);

          const errors: string[] = [];
          const trackedMethods = ["click", "fill", "goto", "waitForSelector", "selectOption", "check", "uncheck", "press", "type"] as const;
          for (const method of trackedMethods) {
            const orig = (page as any)[method].bind(page);
            (page as any)[method] = async (...args: any[]) => {
              try {
                return await orig(...args);
              } catch (err: any) {
                const selector = typeof args[0] === "string" ? args[0].slice(0, 80) : "";
                errors.push(`${method}("${selector}") failed: ${err.message}`);
              }
            };
          }

          const { cleanScript: dryClean } = parseNarration(scriptCode);
          // Replace narrate calls with no-ops for dry run
          const noNarrate = dryClean.replace(/await __narrate__\(\d+\);/g, "await page.waitForTimeout(100);");

          try {
            await page.goto(previewUrl!, { waitUntil: "domcontentloaded", timeout: 15000 });
            await page.waitForTimeout(500);
            const fn = new Function("page", "__narrate__", "loginAs", `return (async () => { ${noNarrate} })()`);
            const noOp = async () => {};
            await Promise.race([
              fn(page, noOp, loginAs),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Dry-run timeout")), 60000)),
            ]);
          } catch {}

          let pageSnapshot = "";
          try {
            pageSnapshot = await page.evaluate(PAGE_SNAPSHOT_JS) as string;
          } catch {}

          await page.close();
          await context.close();
          await browser.close();
          return { errors, pageSnapshot };
        };

        // --- Dry-run: test the script and fix if needed ---
        let currentScript = script;
        sendEvent("progress", { step: "dry_run", message: "Testing script before recording..." });

        const dryRunResult = await runScriptDryRun(currentScript);

        if (dryRunResult.errors.length > 0) {
          sendEvent("progress", {
            step: "fixing",
            message: `${dryRunResult.errors.length} step(s) failed — fixing script...`,
          });

          const fixedScript = await fixBrokenScript(
            currentScript,
            dryRunResult.errors,
            dryRunResult.pageSnapshot,
            task.worktree_dir || undefined,
          );

          if (fixedScript !== currentScript) {
            currentScript = fixedScript;
            // Save fixed script to DB
            updateTaskDemo(task.id, { demo_script: currentScript });
            sendEvent("progress", { step: "fixing", message: "Script fixed, proceeding to record" });
          } else {
            sendEvent("progress", { step: "fixing", message: "Could not auto-fix, recording with original script" });
          }
        } else {
          sendEvent("progress", { step: "dry_run", message: "Script validated, no errors found" });
        }

        // --- Real recording ---
        // Parse narration from (possibly fixed) script
        const { cleanScript, segments } = parseNarration(currentScript);
        const hasNarration = segments.length > 0;

        // Look up the app's TTS voice preference
        const ttsVoice = getAppTtsVoice(app.id) || "en-US-AndrewNeural";

        // Pre-generate TTS clips before recording so we know each clip's duration
        let clipInfos: ClipInfo[] = [];
        const narrationTempDir = path.join(demoDir, `tmp-narration-${taskId}`);
        if (hasNarration) {
          sendEvent("progress", { step: "narration", message: "Generating voice narration..." });
          fs.mkdirSync(narrationTempDir, { recursive: true });
          try {
            clipInfos = await generateTTSClips(segments, narrationTempDir, ttsVoice);
          } catch (ttsErr: any) {
            sendEvent("progress", { step: "narration", message: `Narration warning: ${ttsErr.message}` });
          }
        }

        sendEvent("progress", { step: "recording", message: "Recording video..." });
        updateTaskDemo(taskId, { demo_status: "recording" });

        const videoDir = path.join(demoDir, `tmp-task-${taskId}`);
        fs.mkdirSync(videoDir, { recursive: true });

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          recordVideo: {
            dir: videoDir,
            size: { width: 1280, height: 720 },
          },
          viewport: { width: 1280, height: 720 },
        });

        const page = await context.newPage();
        const loginAs = createLoginAs(context, page);

        // Track real timestamps and pause video for each narration clip
        const recordingStartTime = Date.now();
        const realTimestamps: number[] = [];
        const __narrate__ = async (idx: number) => {
          realTimestamps[idx] = Date.now() - recordingStartTime;
          const clip = clipInfos[idx];
          if (clip?.durationMs > 0) {
            await page.waitForTimeout(clip.durationMs + 300); // 300ms padding
          }
        };

        // Instrument page methods to report failures via SSE
        const trackedMethods = ["click", "fill", "goto", "waitForSelector", "selectOption", "check", "uncheck", "press", "type"] as const;
        const scriptErrors: string[] = [];
        for (const method of trackedMethods) {
          const orig = (page as any)[method].bind(page);
          (page as any)[method] = async (...args: any[]) => {
            try {
              return await orig(...args);
            } catch (err: any) {
              const selector = typeof args[0] === "string" ? args[0].slice(0, 80) : "";
              const msg = `${method}("${selector}") failed: ${err.message}`;
              scriptErrors.push(msg);
              sendEvent("progress", { step: "recording", message: `Step failed: ${method}("${selector.slice(0, 50)}")` });
            }
          };
        }

        try {
          // Navigate to the app
          await page.goto(previewUrl!, { waitUntil: "domcontentloaded", timeout: 15000 });
          await page.waitForTimeout(1000);

          // Execute the script with __narrate__ and loginAs callbacks
          const totalNarrationMs = clipInfos.reduce((sum, c) => sum + c.durationMs + 300, 0);
          const scriptTimeoutMs = 60000 + totalNarrationMs;
          const scriptFn = new Function("page", "__narrate__", "loginAs", `return (async () => { ${cleanScript} })()`);
          await Promise.race([
            scriptFn(page, __narrate__, loginAs),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Script timeout (${Math.round(scriptTimeoutMs / 1000)}s)`)), scriptTimeoutMs)
            ),
            new Promise((_, reject) => {
              abortController.signal.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError"))
              );
            }),
          ]);

          // Brief pause at end for visual closure
          await page.waitForTimeout(1500);
        } catch (scriptErr: any) {
          if (scriptErr.name === "AbortError") throw scriptErr;
          // Script errors are non-fatal — we still save whatever was recorded
          sendEvent("progress", { step: "recording", message: `Script warning: ${scriptErr.message}` });
        }

        if (scriptErrors.length > 0) {
          sendEvent("progress", { step: "recording", message: `${scriptErrors.length} step(s) failed during recording` });
        }

        // Close page to finalize video
        await page.close();
        await context.close();
        await browser.close();

        // Find the recorded video file
        const videoFiles = fs.readdirSync(videoDir).filter(f => f.endsWith(".webm"));
        if (videoFiles.length === 0) {
          throw new Error("No video file was recorded");
        }

        const silentVideoPath = path.join(videoDir, videoFiles[0]);

        // Assemble narration audio from pre-generated clips using raw timestamps
        const audioPath = path.join(demoDir, `task-${taskId}-narration.mp3`);

        if (hasNarration && realTimestamps.length > 0 && clipInfos.length > 0) {
          sendEvent("progress", { step: "narration", message: "Assembling narration audio..." });
          try {
            await assembleNarrationAudio(clipInfos, realTimestamps, audioPath, narrationTempDir);
            try { fs.rmSync(narrationTempDir, { recursive: true }); } catch {}
          } catch (assembleErr: any) {
            sendEvent("progress", { step: "narration", message: `Narration warning: ${assembleErr.message}` });
            try { fs.rmSync(narrationTempDir, { recursive: true }); } catch {}
          }
        } else if (hasNarration) {
          // Clean up temp dir if no clips were generated
          try { fs.rmSync(narrationTempDir, { recursive: true }); } catch {}
        }

        const hasAudio = hasNarration && fs.existsSync(audioPath);
        let finalPath: string;

        const ts = Date.now();
        if (hasAudio) {
          // Merge video + audio into MP4
          sendEvent("progress", { step: "merging", message: "Adding voice narration..." });
          finalPath = path.join(demoDir, `task-${taskId}-${ts}.mp4`);
          try {
            await mergeVideoAudio(silentVideoPath, audioPath, finalPath);
            try { fs.unlinkSync(audioPath); } catch {}
          } catch (mergeErr: any) {
            sendEvent("progress", { step: "merging", message: `Merge warning: ${mergeErr.message}` });
            finalPath = path.join(demoDir, `task-${taskId}-${ts}.webm`);
            fs.renameSync(silentVideoPath, finalPath);
            try { fs.unlinkSync(audioPath); } catch {}
          }
        } else {
          finalPath = path.join(demoDir, `task-${taskId}-${ts}.webm`);
          fs.renameSync(silentVideoPath, finalPath);
        }

        // Clean up temp video dir
        try { fs.rmSync(videoDir, { recursive: true }); } catch {}

        // Update DB — creates a new artifact (old ones are kept for history)
        const artifactId = updateTaskDemo(taskId, {
          demo_status: "completed",
          demo_video_path: finalPath,
          demo_error: null,
        });

        sendEvent("status", { status: "completed", video_path: finalPath, artifact_id: artifactId });
        sendEvent("done", {});

      } catch (e: any) {
        if (e.name === "AbortError") {
          updateTaskDemo(taskId, { demo_status: null, demo_error: null });
          sendEvent("status", { status: "cancelled" });
        } else {
          updateTaskDemo(taskId, {
            demo_status: "failed",
            demo_error: e.message || String(e),
          });
          sendEvent("error", { error: e.message || String(e) });
        }
      } finally {
        clearInterval(keepalive);
        _demoJobs.delete(taskId);
        try { controller.close(); } catch {}
      }
    },
  });
}

/**
 * Cancel an in-progress demo generation.
 */
export function cancelDemo(taskId: number): void {
  const entry = _demoJobs.get(taskId);
  if (entry) {
    entry.abort.abort();
    _demoJobs.delete(taskId);
  }
  updateTaskDemo(taskId, { demo_status: null, demo_error: null });
}

/**
 * Get demo status for a work item.
 */
export function getDemoStatus(workItemId: number): {
  demo_status: DemoStatus;
  demo_video_path: string | null;
  demo_error: string | null;
} {
  const task = loadTaskCompat(workItemId);
  if (!task) return { demo_status: null, demo_video_path: null, demo_error: null };
  return {
    demo_status: task.demo_status,
    demo_video_path: task.demo_video_path,
    demo_error: task.demo_error,
  };
}

/**
 * Delete a demo video.
 */
export function deleteDemo(workItemId: number): void {
  // Delete ALL video files on disk (not just latest)
  const allVideos = dal.getArtifacts(workItemId, "demo_video");
  for (const art of allVideos) {
    if (art.file_path) {
      try { fs.unlinkSync(art.file_path); } catch {}
    }
  }
  dal.deleteArtifactsByKind(workItemId, "demo_video");
  updateTaskDemo(workItemId, {
    demo_status: null,
    demo_error: null,
  });
}

/**
 * Get the video file path for a work item.
 */
export function getVideoPath(workItemId: number): string | null {
  const videoArt = dal.getArtifactByKind(workItemId, "demo_video");
  return videoArt?.file_path || null;
}

/**
 * Check if demo generation is in progress.
 */
export function isDemoRunning(workItemId: number): boolean {
  return _demoJobs.has(workItemId);
}
