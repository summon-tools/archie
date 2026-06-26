/**
 * Repo-local skills file utilities.
 * Reads/writes skill files at {app.directory}/.archie/skills/
 * Skills capture team conventions, playbooks, and practices.
 *
 * Skill format:
 * ---
 * name: skill-name
 * description: When and how to use this skill
 * ---
 * # Markdown content
 */

import fs from "fs";
import path from "path";

export interface SkillEntry {
  filename: string;
  name: string;
  description: string;
}

export interface SkillIndex {
  entries: SkillEntry[];
}

export interface SkillMeta {
  name: string;
  description: string;
}

const SKILLS_DIR = ".archie/skills";
const INDEX_FILE = "_index.md";

function skillsDir(directory: string): string {
  return path.join(directory, SKILLS_DIR);
}

function parseFrontmatter(content: string): {
  meta: Record<string, string | string[]>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].trim();
    const value = kvMatch[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    } else {
      meta[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  return { meta, body: match[2] };
}

/**
 * Ensure the .archie/skills/ directory exists.
 */
export function ensureSkillsDir(directory: string): void {
  fs.mkdirSync(skillsDir(directory), { recursive: true });
}

/**
 * Parse _index.md for skills. Returns index or null if no skills exist.
 * Format:
 * # Team Skills
 *
 * - filename.md: Description text
 */
export function readSkillsIndex(directory: string): SkillIndex | null {
  const indexPath = path.join(skillsDir(directory), INDEX_FILE);
  if (!fs.existsSync(indexPath)) return null;

  try {
    const content = fs.readFileSync(indexPath, "utf-8");
    const lines = content.split("\n");
    const entries: SkillEntry[] = [];

    for (const line of lines) {
      const entryMatch = line.match(/^-\s+(.+\.md):\s+(.+)$/);
      if (entryMatch) {
        const filename = entryMatch[1].trim();
        const description = entryMatch[2].trim();
        const name = filename.replace(/\.md$/, "");
        entries.push({ filename, name, description });
      }
    }

    return { entries };
  } catch {
    return null;
  }
}

/**
 * Write the skills index file.
 */
export function writeSkillsIndex(directory: string, entries: SkillEntry[]): void {
  const lines = ["# Team Skills", ""];
  for (const entry of entries) {
    lines.push(`- ${entry.filename}: ${entry.description}`);
  }
  lines.push("");

  const fullPath = path.join(skillsDir(directory), INDEX_FILE);
  ensureSkillsDir(directory);
  fs.writeFileSync(fullPath, lines.join("\n"), "utf-8");
}

/**
 * Read a skill file's content.
 */
export function readSkillFile(directory: string, filename: string): string | null {
  const fullPath = path.join(skillsDir(directory), filename);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Write a skill file, updating the index automatically.
 */
export function writeSkillFile(directory: string, filename: string, content: string): void {
  ensureSkillsDir(directory);
  const fullPath = path.join(skillsDir(directory), filename);
  fs.writeFileSync(fullPath, content, "utf-8");

  // Update index
  const meta = extractSkillMeta(content);
  const index = readSkillsIndex(directory);
  const entries = index?.entries || [];
  const existing = entries.find((e) => e.filename === filename);
  if (existing) {
    existing.name = meta.name;
    existing.description = meta.description;
  } else {
    entries.push({ filename, name: meta.name, description: meta.description });
  }
  writeSkillsIndex(directory, entries);
}

/**
 * Delete a skill file and remove from index.
 */
export function deleteSkillFile(directory: string, filename: string): boolean {
  const fullPath = path.join(skillsDir(directory), filename);
  try {
    fs.unlinkSync(fullPath);
  } catch {
    return false;
  }

  // Update index
  const index = readSkillsIndex(directory);
  if (index) {
    const entries = index.entries.filter((e) => e.filename !== filename);
    if (entries.length === 0) {
      try {
        fs.unlinkSync(path.join(skillsDir(directory), INDEX_FILE));
      } catch {}
    } else {
      writeSkillsIndex(directory, entries);
    }
  }

  return true;
}

/**
 * List all .md skill files (excluding _index.md).
 */
export function listSkillFiles(directory: string): string[] {
  const dir = skillsDir(directory);
  if (!fs.existsSync(dir)) return [];

  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".md") && f !== INDEX_FILE)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Extract metadata from skill file frontmatter.
 */
export function extractSkillMeta(content: string): SkillMeta {
  const { meta } = parseFrontmatter(content);
  return {
    name: (typeof meta.name === "string" ? meta.name : "") || "",
    description: (typeof meta.description === "string" ? meta.description : "") || "",
  };
}

/**
 * Validate that a skill has the required fields.
 * Returns null if valid, or an error message if invalid.
 */
export function validateSkillContent(content: string): string | null {
  const meta = extractSkillMeta(content);

  if (!meta.name.trim()) {
    return "name is required in frontmatter";
  }
  if (!meta.description.trim()) {
    return "description is required in frontmatter";
  }

  return null;
}
