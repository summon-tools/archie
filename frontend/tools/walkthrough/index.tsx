"use client";

import { useState, useRef, useCallback } from "react";
import { Play, SpinnerGap } from "@phosphor-icons/react";
import { appWalkthroughStep } from "@/lib/api";
import { walkthroughDefinition } from "./definition";
import type { Tool, ToolContext, ToolState } from "../types";
import { ensurePreviewRunning } from "../ensurePreview";

// ---------- Helpers ----------

const PAGE_SNAPSHOT_JS = `(() => {
  const items = [];
  document.querySelectorAll("h1, h2, h3").forEach(el => {
    const text = el.innerText?.trim();
    if (text) items.push("<" + el.tagName.toLowerCase() + ">" + text + "</" + el.tagName.toLowerCase() + ">");
  });
  document.querySelectorAll("a[href]").forEach(el => {
    const href = el.getAttribute("href") || "";
    const text = el.innerText?.trim().slice(0, 80) || "";
    if (!href || href.startsWith("javascript:")) return;
    items.push('<a href="' + href + '">' + text + '</a>');
  });
  document.querySelectorAll("button, [role='button']").forEach(el => {
    const text = el.innerText?.trim().slice(0, 80) || "";
    const type = el.getAttribute("type") || "";
    const disabled = el.hasAttribute("disabled") ? " disabled" : "";
    items.push("<button" + (type ? ' type="' + type + '"' : "") + disabled + ">" + text + "</button>");
  });
  document.querySelectorAll("input, textarea, select").forEach(el => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "hidden") return;
    const id = el.getAttribute("id") || "";
    const name = el.getAttribute("name") || "";
    const placeholder = el.getAttribute("placeholder") || "";
    let labelText = "";
    if (id) { const lbl = document.querySelector('label[for="' + id + '"]'); if (lbl) labelText = lbl.innerText?.trim().slice(0, 80) || ""; }
    let desc = "<" + tag;
    if (id) desc += ' id="' + id + '"';
    if (name) desc += ' name="' + name + '"';
    if (type) desc += ' type="' + type + '"';
    if (placeholder) desc += ' placeholder="' + placeholder + '"';
    if (tag === "select") { const opts = []; el.querySelectorAll("option").forEach(o => opts.push(o.textContent?.trim())); desc += ">" + opts.filter(Boolean).join(" | ") + "</select>"; }
    else desc += " />";
    if (labelText) desc += " <!-- label: " + labelText + " -->";
    items.push(desc);
  });
  document.querySelectorAll("nav").forEach(el => {
    const links = [];
    el.querySelectorAll("a[href]").forEach(a => { const href = a.getAttribute("href") || ""; const text = a.innerText?.trim().slice(0, 40) || ""; if (href && text) links.push(text + " -> " + href); });
    if (links.length > 0) items.push("<nav>\\n  " + links.join("\\n  ") + "\\n</nav>");
  });
  return items.join("\\n");
})()`;

/**
 * Detects common application error pages from the page snapshot HTML.
 * Returns a human-readable error description, or null if no error detected.
 */
function detectAppError(pageSnapshot: string): string | null {
  if (!pageSnapshot) return null;
  // Rails errors (Propshaft, ActionView, ActiveRecord, etc.)
  if (/Propshaft::[\w]+Error|ActionView::[\w:]+Error|ActiveRecord::[\w:]+Error/.test(pageSnapshot))
    return "Rails application error — missing assets or template issue";
  if (/NoMethodError|NameError|SyntaxError|RuntimeError/.test(pageSnapshot) && /Rails\.root|action_dispatch|__better_errors/.test(pageSnapshot))
    return "Rails runtime error";
  // Django errors
  if (/Server Error \(500\)|Traceback \(most recent call last\)/.test(pageSnapshot))
    return "Django application error";
  if (/TemplateSyntaxError|ImproperlyConfigured|OperationalError/.test(pageSnapshot) && /django|DJANGO/.test(pageSnapshot))
    return "Django configuration error";
  // Next.js / React errors
  if (/Unhandled Runtime Error|Internal Server Error.*Next\.js/.test(pageSnapshot))
    return "Next.js runtime error";
  // Generic 500
  if (/Internal Server Error|HTTP ERROR 500|500 Internal/.test(pageSnapshot))
    return "Server error (500)";
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

function waitForLoad(iframe: HTMLIFrameElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const onLoad = () => { iframe.removeEventListener("load", onLoad); resolve(); };
    iframe.addEventListener("load", onLoad);
    const t = setTimeout(() => { iframe.removeEventListener("load", onLoad); resolve(); }, 5000);
    signal.addEventListener("abort", () => { clearTimeout(t); iframe.removeEventListener("load", onLoad); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

function findElement(doc: Document, selector: string, proxyBase?: string): Element | null {
  const textMatch = selector.match(/^text=["']?(.+?)["']?$/);
  if (textMatch) {
    const text = textMatch[1];
    for (const el of doc.querySelectorAll("a, button, [role='button'], h1, h2, h3, li, span, p, td, th, label")) {
      if (el.textContent?.trim().includes(text)) return el;
    }
    for (const el of doc.querySelectorAll("*")) {
      if (el.children.length === 0 && el.textContent?.trim().includes(text)) return el;
    }
    return null;
  }
  try { const el = doc.querySelector(selector); if (el) return el; } catch {}
  if (proxyBase) {
    try {
      const proxied = selector.replace(/href=["'](\/.+?)["']/g, (_, p) => `href="${proxyBase}${p}"`);
      if (proxied !== selector) return doc.querySelector(proxied);
    } catch {}
  }
  return null;
}

// ---------- Tool hook ----------

function useWalkthroughTool(ctx: ToolContext): ToolState {
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const cancel = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setBusy(false);
    setProgress(null);
  }, []);

  const captureSnapshot = useCallback(() => {
    const iframe = ctx.iframeRef.current;
    if (!iframe) return { pageSnapshot: "", currentPath: "/", viewportWidth: 1280, viewportHeight: 720 };
    let pageSnapshot = "", currentPath = "/";
    const viewportWidth = iframe.clientWidth || 1280;
    const viewportHeight = iframe.clientHeight || 720;
    try {
      const win = iframe.contentWindow;
      if (win) {
        pageSnapshot = (win as any).eval(PAGE_SNAPSHOT_JS) as string;
        if (ctx.proxyBase) pageSnapshot = pageSnapshot.replaceAll(ctx.proxyBase, "");
        const fullPath = win.location.pathname || "";
        const idx = fullPath.indexOf("/api/p/");
        if (idx >= 0) { currentPath = "/" + fullPath.slice(idx).split("/").slice(4).join("/") || "/"; }
        else currentPath = fullPath || "/";
      }
    } catch {}
    return { pageSnapshot, currentPath, viewportWidth, viewportHeight };
  }, [ctx.iframeRef, ctx.proxyBase]);

  const rewriteActions = useCallback((actions: any[]) => {
    return actions.map((a: any) => {
      const p = { ...a };
      if (p.selector) p.selector = p.selector.replace(/href=["'](\/[^"']*?)["']/g, (_: string, path: string) => `href="${ctx.proxyBase}${path}"`);
      if (p.code) {
        p.code = p.code.replace(/href=["'](\/[^"']*?)["']/g, (_: string, path: string) => `href="${ctx.proxyBase}${path}"`);
        p.code = p.code.replace(/href\*=["'](\/[^"']*?)["']/g, (_: string, path: string) => `href*="${ctx.proxyBase}${path}"`);
      }
      return p;
    });
  }, [ctx.proxyBase]);

  const executeActions = useCallback(async (actions: any[], signal: AbortSignal) => {
    for (const action of actions) {
      if (signal.aborted) break;
      const iframe = ctx.iframeRef.current;
      if (!iframe) break;
      try {
        switch (action.type) {
          case "goto": {
            if (!action.path) break;
            const n = action.path.startsWith("/") ? action.path : `/${action.path}`;
            iframe.src = `${ctx.proxyBase}${n}`;
            await waitForLoad(iframe, signal);
            await sleep(500, signal);
            break;
          }
          case "click": {
            if (!action.selector) break;
            const doc = iframe.contentDocument;
            if (!doc) break;
            const el = findElement(doc, action.selector, ctx.proxyBase);
            if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); await sleep(300, signal); (el as HTMLElement).click(); }
            break;
          }
          case "fill": {
            if (!action.selector || action.value === undefined) break;
            const doc = iframe.contentDocument;
            if (!doc) break;
            const el = findElement(doc, action.selector, ctx.proxyBase) as HTMLInputElement | null;
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" }); await sleep(200, signal); el.focus();
              const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
              if (s) s.call(el, action.value); else el.value = action.value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            break;
          }
          case "wait": await sleep(action.ms || 1000, signal); break;
          case "evaluate": {
            if (!action.code) break;
            const w = iframe.contentWindow;
            if (w) { try { (w as any).eval(action.code); } catch {} await sleep(500, signal); }
            break;
          }
          case "narrate": {
            if (action.audioData) {
              const audio = new Audio(action.audioData);
              const pp = audio.play().catch(() => {});
              await Promise.race([
                sleep((action.audioDurationMs || 3000) + 300, signal),
                new Promise<void>(r => { signal.addEventListener("abort", () => { audio.pause(); r(); }, { once: true }); }),
              ]);
              await pp;
            } else await sleep(2000, signal);
            break;
          }
        }
      } catch (e: any) { if (signal.aborted) break; }
    }
  }, [ctx.iframeRef, ctx.proxyBase]);

  const execute = useCallback(async (goal: string) => {
    cancel();
    setBusy(true);
    setProgress("Starting walkthrough...");

    const history: { narration: string; path: string }[] = [];
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // Ensure preview is running before walkthrough
      const previewReady = await ensurePreviewRunning(ctx, setProgress);
      if (!previewReady) {
        await ctx.saveMessage("Could not start the preview. Please start it manually and try again.", "assistant");
        await ctx.reloadMessages();
        return;
      }

      // Switch to preview tab so the iframe is visible and we can capture snapshots
      ctx.setForceTab?.("preview");
      // Wait for the iframe to mount and load
      setProgress("Loading preview...");
      await sleep(2000, abort.signal);

      let stepCount = 0;
      while (stepCount < 20 && !abort.signal.aborted) {
        stepCount++;
        setProgress(`Step ${stepCount}...`);

        const snapshot = captureSnapshot();

        // Check for app errors before proceeding
        const appError = detectAppError(snapshot.pageSnapshot);
        if (appError) {
          await ctx.saveMessage(
            `⚠️ The walkthrough paused because the app is showing an error: **${appError}**.\n\nWould you like me to try to fix it, or would you prefer to fix it yourself and retry the walkthrough?`,
            "assistant",
            "walkthrough"
          );
          await ctx.reloadMessages();
          break;
        }

        const result = await appWalkthroughStep(ctx.appId, { goal, ...snapshot, history });
        if (abort.signal.aborted) break;

        const actions = rewriteActions(result.actions);
        if (actions.length === 0 && result.done) break;

        // Save narration to chat
        if (result.narrationText) {
          await ctx.saveMessage(result.narrationText, "assistant", "walkthrough");
          await ctx.reloadMessages();
        }

        await executeActions(actions, abort.signal);
        if (result.narrationText) history.push({ narration: result.narrationText, path: captureSnapshot().currentPath });
        if (result.done) break;
        await sleep(300, abort.signal);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") console.error("Walkthrough failed:", e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [ctx, cancel, captureSnapshot, rewriteActions, executeActions]);

  return { execute, cancel, busy, progress };
}

// ---------- Components ----------

function WalkthroughProgress({ progress }: { progress: string | null }) {
  return (
    <div className="flex items-start gap-2.5 animate-fadeIn">
      <div className="w-7 h-7 rounded-full bg-brand-400/20 flex items-center justify-center flex-shrink-0 mt-1">
        <Play size={14} weight="fill" className="text-brand-300" />
      </div>
      <div className="bg-brand-400/10 border border-brand-400/20 rounded-2xl rounded-tl-md px-4 py-3">
        <div className="flex items-center gap-2">
          <SpinnerGap size={14} className="animate-spin text-brand-300" />
          <span className="text-sm text-brand-300">{progress || "Starting walkthrough..."}</span>
        </div>
      </div>
    </div>
  );
}

function WalkthroughResult({ content }: { content: string; appId: number; itemId: number }) {
  return (
    <div className="flex items-start gap-2.5 animate-fadeIn">
      <div className="w-7 h-7 rounded-full bg-brand-400/20 flex items-center justify-center flex-shrink-0 mt-1">
        <Play size={14} weight="fill" className="text-brand-300" />
      </div>
      <div className="max-w-[80%] bg-brand-400/10 border border-brand-400/20 rounded-2xl rounded-tl-md px-4 py-3">
        <p className="text-sm text-brand-300 italic leading-relaxed">&ldquo;{content}&rdquo;</p>
      </div>
    </div>
  );
}

// ---------- Export ----------

export const walkthrough: Tool = {
  ...walkthroughDefinition,
  icon: Play,
  useTool: useWalkthroughTool,
  ProgressCard: WalkthroughProgress,
  ResultCard: WalkthroughResult,
};
