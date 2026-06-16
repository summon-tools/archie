import { getDb } from "../db";
import type { GlobalSkillRow } from "../types";

const MAX_SKILL_PARTS = 12;
const MAX_SKILL_PART_NAME_LENGTH = 80;
const MAX_SKILL_PART_BODY_LENGTH = 16000;

export interface GlobalSkillPart {
  name: string;
  body_md: string;
}

export interface GlobalSkillRecord {
  id: number;
  slug: string;
  name: string;
  description: string;
  body_md: string;
  parts: GlobalSkillPart[];
  trigger_phrases: string[];
  enabled: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface GlobalSkillWriteInput {
  slug?: string;
  name?: string;
  description?: string;
  body_md?: string;
  parts?: GlobalSkillPart[];
  trigger_phrases?: string[];
  enabled?: boolean;
  created_by?: number | null;
  updated_by?: number | null;
}

export function normalizeGlobalSkillSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function normalizeTriggerPhrases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const phrase = entry.trim().replace(/\s+/g, " ");
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase.slice(0, 160));
    if (phrases.length >= 30) break;
  }
  return phrases;
}

export function normalizeGlobalSkillParts(value: unknown): GlobalSkillPart[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const parts: GlobalSkillPart[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.body_md !== "string") continue;

    const name = record.name.trim().replace(/\s+/g, " ").slice(0, MAX_SKILL_PART_NAME_LENGTH);
    const bodyMd = record.body_md.trim().slice(0, MAX_SKILL_PART_BODY_LENGTH);
    if (!name || !bodyMd) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push({ name, body_md: bodyMd });
    if (parts.length >= MAX_SKILL_PARTS) break;
  }
  return parts;
}

function parseTriggerPhrases(value: string): string[] {
  try {
    return normalizeTriggerPhrases(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseGlobalSkillParts(value: string): GlobalSkillPart[] {
  try {
    return normalizeGlobalSkillParts(JSON.parse(value));
  } catch {
    return [];
  }
}

function serializeGlobalSkill(row: GlobalSkillRow): GlobalSkillRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    body_md: row.body_md,
    parts: parseGlobalSkillParts(row.parts_json),
    trigger_phrases: parseTriggerPhrases(row.trigger_phrases_json),
    enabled: row.enabled === 1,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listGlobalSkills(opts: { enabledOnly?: boolean } = {}): GlobalSkillRecord[] {
  const rows = opts.enabledOnly
    ? getDb()
        .prepare("SELECT * FROM global_skills WHERE enabled = 1 ORDER BY name COLLATE NOCASE ASC")
        .all()
    : getDb()
        .prepare("SELECT * FROM global_skills ORDER BY enabled DESC, name COLLATE NOCASE ASC")
        .all();
  return (rows as GlobalSkillRow[]).map(serializeGlobalSkill);
}

export function getGlobalSkillBySlug(slug: string): GlobalSkillRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM global_skills WHERE slug = ?")
    .get(normalizeGlobalSkillSlug(slug)) as GlobalSkillRow | undefined;
  return row ? serializeGlobalSkill(row) : undefined;
}

export function createGlobalSkill(input: Required<Pick<GlobalSkillWriteInput, "slug" | "name" | "description" | "body_md" | "trigger_phrases" | "enabled">> & Pick<GlobalSkillWriteInput, "parts" | "created_by" | "updated_by">): GlobalSkillRecord {
  const slug = normalizeGlobalSkillSlug(input.slug);
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO global_skills
      (slug, name, description, body_md, parts_json, trigger_phrases_json, enabled, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    slug,
    input.name,
    input.description,
    input.body_md,
    JSON.stringify(normalizeGlobalSkillParts(input.parts ?? [])),
    JSON.stringify(normalizeTriggerPhrases(input.trigger_phrases)),
    input.enabled ? 1 : 0,
    input.created_by ?? null,
    input.updated_by ?? input.created_by ?? null,
  );

  const row = db.prepare("SELECT * FROM global_skills WHERE id = ?").get(result.lastInsertRowid) as GlobalSkillRow;
  return serializeGlobalSkill(row);
}

export function updateGlobalSkill(slug: string, input: GlobalSkillWriteInput): GlobalSkillRecord | undefined {
  const current = getGlobalSkillBySlug(slug);
  if (!current) return undefined;

  const nextSlug = input.slug === undefined ? current.slug : normalizeGlobalSkillSlug(input.slug);
  const nextName = input.name === undefined ? current.name : input.name;
  const nextDescription = input.description === undefined ? current.description : input.description;
  const nextBody = input.body_md === undefined ? current.body_md : input.body_md;
  const nextParts = input.parts === undefined ? current.parts : normalizeGlobalSkillParts(input.parts);
  const nextTriggers = input.trigger_phrases === undefined
    ? current.trigger_phrases
    : normalizeTriggerPhrases(input.trigger_phrases);
  const nextEnabled = input.enabled === undefined ? current.enabled : input.enabled;

  getDb().prepare(
    `UPDATE global_skills
     SET slug = ?,
         name = ?,
         description = ?,
         body_md = ?,
         parts_json = ?,
         trigger_phrases_json = ?,
         enabled = ?,
         updated_by = ?,
         updated_at = datetime('now')
     WHERE slug = ?`
  ).run(
    nextSlug,
    nextName,
    nextDescription,
    nextBody,
    JSON.stringify(nextParts),
    JSON.stringify(nextTriggers),
    nextEnabled ? 1 : 0,
    input.updated_by ?? null,
    current.slug,
  );

  return getGlobalSkillBySlug(nextSlug);
}

export function deleteGlobalSkill(slug: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM global_skills WHERE slug = ?")
    .run(normalizeGlobalSkillSlug(slug));
  return result.changes > 0;
}
