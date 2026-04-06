/**
 * Living spec file utilities.
 * Reads/writes spec files at {app.directory}/.archie/spec/
 * The spec's folder structure IS the retrieval mechanism — no RAG needed.
 */

import fs from "fs";
import path from "path";

export interface SpecEntry {
  path: string;
  summary: string;
}

export interface SpecIndex {
  appName: string;
  entries: SpecEntry[];
}

const SPEC_DIR = ".archie/spec";
const INDEX_FILE = "_index.md";
const PRINCIPLES_FILE = "PRINCIPLES.md";

function specDir(directory: string): string {
  return path.join(directory, SPEC_DIR);
}

/**
 * Parse _index.md, returns spec index or null if no spec exists.
 * Format:
 * # App Name
 *
 * - path/to/file.md: One-line summary
 */
export function readSpecIndex(directory: string): SpecIndex | null {
  const indexPath = path.join(specDir(directory), INDEX_FILE);
  if (!fs.existsSync(indexPath)) return null;

  try {
    const content = fs.readFileSync(indexPath, "utf-8");
    const lines = content.split("\n");

    let appName = "";
    const entries: SpecEntry[] = [];

    for (const line of lines) {
      const titleMatch = line.match(/^#\s+(.+)$/);
      if (titleMatch) {
        appName = titleMatch[1].trim();
        continue;
      }

      const entryMatch = line.match(/^-\s+(.+?):\s+(.+)$/);
      if (entryMatch) {
        entries.push({ path: entryMatch[1].trim(), summary: entryMatch[2].trim() });
      }
    }

    return { appName, entries };
  } catch {
    return null;
  }
}

/**
 * Read PRINCIPLES.md if it exists.
 */
export function readPrinciples(directory: string): string | null {
  const fullPath = path.join(specDir(directory), PRINCIPLES_FILE);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read a spec file's content.
 */
export function readSpecFile(directory: string, filePath: string): string | null {
  const fullPath = path.join(specDir(directory), filePath);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Write a spec file, creating directories as needed.
 */
export function writeSpecFile(directory: string, filePath: string, content: string): void {
  const fullPath = path.join(specDir(directory), filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

/**
 * Regenerate _index.md from entries.
 */
export function writeSpecIndex(directory: string, appName: string, entries: SpecEntry[]): void {
  const lines = [`# ${appName}`, ""];
  for (const entry of entries) {
    lines.push(`- ${entry.path}: ${entry.summary}`);
  }
  lines.push("");

  const fullPath = path.join(specDir(directory), INDEX_FILE);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, lines.join("\n"), "utf-8");
}

/**
 * List all .md files under .archie/spec/ (excluding _index.md).
 */
export function listSpecFiles(directory: string): string[] {
  const dir = specDir(directory);
  if (!fs.existsSync(dir)) return [];

  const results: string[] = [];

  function walk(currentDir: string, prefix: string) {
    const items = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        walk(path.join(currentDir, item.name), prefix ? `${prefix}/${item.name}` : item.name);
      } else if (item.name.endsWith(".md") && item.name !== INDEX_FILE) {
        results.push(prefix ? `${prefix}/${item.name}` : item.name);
      }
    }
  }

  walk(dir, "");
  return results.sort();
}

/**
 * Delete a spec file. Returns true if file existed and was deleted.
 */
export function deleteSpecFile(directory: string, filePath: string): boolean {
  const fullPath = path.join(specDir(directory), filePath);
  try {
    fs.unlinkSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse YAML frontmatter from spec file content.
 * Returns metadata fields and the body without frontmatter.
 */
export function parseFrontmatter(content: string): {
  meta: Record<string, string | string[]>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value = kvMatch[2].trim();
      // Handle arrays like [tag1, tag2]
      if (value.startsWith("[") && value.endsWith("]")) {
        meta[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      } else {
        meta[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }

  return { meta, body: match[2] };
}

/**
 * Insert or update `updated_at` in frontmatter.
 */
export function setFrontmatterDate(content: string): string {
  const now = new Date().toISOString().split("T")[0];
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (match) {
    let fm = match[1];
    if (/^updated_at\s*:/m.test(fm)) {
      fm = fm.replace(/^updated_at\s*:.*$/m, `updated_at: ${now}`);
    } else {
      fm += `\nupdated_at: ${now}`;
    }
    return content.replace(/^---\n[\s\S]*?\n---/, `---\n${fm}\n---`);
  }
  return content;
}

// Keyword sets for tool-based spec selection
const TOOL_KEYWORDS: Record<string, string[]> = {
  seed: ["auth", "role", "user", "model", "data", "account", "schema", "credential"],
  walkthrough: ["flow", "route", "navigation", "login", "dashboard", "crud", "page", "url"],
  video: ["flow", "feature", "demo", "dashboard", "crud", "overview", "walkthrough"],
};

/**
 * Returns concatenated spec content relevant to a tool type.
 * Uses keyword matching against the index to select relevant files.
 * Capped at ~8000 chars.
 */
export function getSpecForTool(directory: string, toolType: string): string | null {
  const index = readSpecIndex(directory);
  if (!index || index.entries.length === 0) return null;

  const keywords = TOOL_KEYWORDS[toolType] || TOOL_KEYWORDS.walkthrough;

  // Score each entry by keyword matches in path + summary + frontmatter
  const scored = index.entries.map((entry) => {
    const text = `${entry.path} ${entry.summary}`.toLowerCase();
    let score = keywords.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);

    // Bonus score from frontmatter metadata
    const content = readSpecFile(directory, entry.path);
    if (content) {
      const { meta } = parseFrontmatter(content);
      if (meta.kind && typeof meta.kind === "string" && meta.kind.toLowerCase() === toolType) {
        score += 3;
      }
      if (meta.area && typeof meta.area === "string") {
        const area = meta.area.toLowerCase();
        score += keywords.reduce((s, kw) => s + (area.includes(kw) ? 1 : 0), 0);
      }
      if (Array.isArray(meta.tags)) {
        const tags = meta.tags.map((t) => t.toLowerCase());
        score += keywords.reduce((s, kw) => s + (tags.some((t) => t.includes(kw)) ? 1 : 0), 0);
      }
    }

    return { entry, score };
  });

  // Sort by score descending, take entries with score > 0, then fill with others if space allows
  scored.sort((a, b) => b.score - a.score);

  const parts: string[] = [];
  let totalLength = 0;
  const MAX_CHARS = 8000;

  for (const { entry } of scored) {
    const content = readSpecFile(directory, entry.path);
    if (!content) continue;

    if (totalLength + content.length > MAX_CHARS) {
      // If we have nothing yet, include a truncated version
      if (parts.length === 0) {
        parts.push(`## ${entry.path}\n${content.slice(0, MAX_CHARS)}`);
      }
      break;
    }

    parts.push(`## ${entry.path}\n${content}`);
    totalLength += content.length;
  }

  return parts.length > 0 ? parts.join("\n\n---\n\n") : null;
}

/**
 * Extract the one-line summary from a spec file's content.
 * Looks for a blockquote line after the title: > Summary here
 */
export function extractSummary(content: string): string {
  const match = content.match(/^>\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

// ── Spec Proposals ─────────────────────────────────────────────────

export interface SpecProposal {
  id: string;
  action: "update" | "create";
  path: string;
  content: string;
  old_content?: string;
  created_at: string;
}

const PENDING_FILE = "_pending.json";

/**
 * Read pending spec proposals.
 */
export function readSpecProposals(directory: string): SpecProposal[] {
  const fullPath = path.join(specDir(directory), PENDING_FILE);
  try {
    const raw = fs.readFileSync(fullPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Write pending spec proposals.
 */
export function writeSpecProposals(directory: string, proposals: SpecProposal[]): void {
  const dir = specDir(directory);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PENDING_FILE), JSON.stringify(proposals, null, 2), "utf-8");
}

/**
 * Apply a single proposal: write file + update index.
 */
export function applySpecProposal(directory: string, proposal: SpecProposal): void {
  writeSpecFile(directory, proposal.path, proposal.content);

  const index = readSpecIndex(directory);
  if (!index) return;
  const entries = [...index.entries];
  const summary = extractSummary(proposal.content);

  if (proposal.action === "update") {
    const existing = entries.find((e) => e.path === proposal.path);
    if (existing && summary) existing.summary = summary;
  } else {
    if (!entries.find((e) => e.path === proposal.path)) {
      entries.push({ path: proposal.path, summary: summary || proposal.path });
    }
  }
  writeSpecIndex(directory, index.appName, entries);
}

/**
 * Remove a proposal by ID.
 */
export function removeSpecProposal(directory: string, proposalId: string): void {
  const proposals = readSpecProposals(directory);
  const filtered = proposals.filter((p) => p.id !== proposalId);
  if (filtered.length === 0) {
    // Clean up the file entirely
    try {
      fs.unlinkSync(path.join(specDir(directory), PENDING_FILE));
    } catch {}
  } else {
    writeSpecProposals(directory, filtered);
  }
}

// ── Task Proposals (from spec changes) ────────────────────────────

export interface TaskProposal {
  id: string;
  title: string;
  description: string;
  spec_path: string;
  created_at: string;
}

const PENDING_TASKS_FILE = "_pending_tasks.json";

export function readTaskProposals(directory: string): TaskProposal[] {
  const fullPath = path.join(specDir(directory), PENDING_TASKS_FILE);
  try {
    const raw = fs.readFileSync(fullPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function writeTaskProposals(directory: string, proposals: TaskProposal[]): void {
  const dir = specDir(directory);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PENDING_TASKS_FILE), JSON.stringify(proposals, null, 2), "utf-8");
}

export function removeTaskProposal(directory: string, proposalId: string): void {
  const proposals = readTaskProposals(directory);
  const filtered = proposals.filter((p) => p.id !== proposalId);
  if (filtered.length === 0) {
    try {
      fs.unlinkSync(path.join(specDir(directory), PENDING_TASKS_FILE));
    } catch {}
  } else {
    writeTaskProposals(directory, filtered);
  }
}

// ── Drift Detection ───────────────────────────────────────────────

export interface DriftResult {
  path: string;
  status: "ok" | "drifted" | "missing";
  detail: string;
}

export function readDriftResults(directory: string): DriftResult[] {
  const fullPath = path.join(specDir(directory), "_drift.json");
  try {
    const raw = fs.readFileSync(fullPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function writeDriftResults(directory: string, results: DriftResult[]): void {
  const dir = specDir(directory);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "_drift.json"), JSON.stringify(results, null, 2), "utf-8");
}

export function clearDriftResults(directory: string): void {
  try {
    fs.unlinkSync(path.join(specDir(directory), "_drift.json"));
  } catch {}
}

export function removeDriftResult(directory: string, specPath: string): void {
  const results = readDriftResults(directory);
  const filtered = results.filter((r) => r.path !== specPath);
  if (filtered.length === 0) {
    clearDriftResults(directory);
  } else {
    writeDriftResults(directory, filtered);
  }
}

/**
 * Run spec validation and write fresh drift results.
 * Extracted from the validate route so automations can call it directly.
 * Returns the validated drift results, or throws on provider/parse failure.
 * Callers must distinguish between an empty (clean) result and a thrown error.
 */
export async function runSpecValidation(
  directory: string,
  appName: string
): Promise<DriftResult[]> {
  const specIndex = readSpecIndex(directory);
  if (!specIndex || specIndex.entries.length === 0) return [];

  const { runToolEnabledStream } = await import("./sdk-helpers");
  const { buildSpecValidationPrompt } = await import("./prompts/spec");

  const specSummary = specIndex.entries
    .map((e) => {
      const content = readSpecFile(directory, e.path);
      return content ? `## ${e.path}\n${content.slice(0, 800)}` : null;
    })
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 6000);

  const filePaths = specIndex.entries.map((e) => e.path);
  const prompt = buildSpecValidationPrompt({ appName, directory, specSummary, filePaths });

  let resultText = "";
  const toolStream = runToolEnabledStream(prompt, { category: "background", cwd: directory });
  for await (const event of toolStream) {
    if (event.type === "result" && event.resultText) {
      resultText = event.resultText;
    }
  }

  // No output = provider/tool failure. Throw so the caller can record a failed run
  // rather than treating this as "no drift found" (false negative).
  if (!resultText) throw new Error("Spec validation produced no output — provider may have failed");

  let results: DriftResult[];
  try {
    const cleaned = resultText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    results = JSON.parse(cleaned).results;
  } catch {
    const match = resultText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Spec validation output could not be parsed as JSON");
    try {
      results = JSON.parse(match[0]).results;
    } catch {
      throw new Error("Spec validation output could not be parsed as JSON");
    }
  }

  if (!results || !Array.isArray(results)) {
    throw new Error("Spec validation returned unexpected shape (missing results array)");
  }

  writeDriftResults(directory, results);
  return results;
}
