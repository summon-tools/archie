import * as dal from "./dal";
import type { GlobalSkillRecord } from "./dal/global-skills";

const MAX_INDEX_SKILLS = 40;
const MAX_DESCRIPTION_CHARS = 220;
const MAX_ACTIVE_SKILLS = 4;
const MAX_BODY_CHARS = 12000;
const MAX_PART_BODY_CHARS = 8000;
const MAX_PARTS_TOTAL_CHARS = 18000;

export interface GlobalSkillPromptContext {
  indexText: string;
  activeText: string;
  unavailableText: string;
  promptText: string;
  activeSkills: GlobalSkillRecord[];
  disabledSlashSlugs: string[];
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 14).trimEnd()}\n[truncated]`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function containsTerm(text: string, term: string): boolean {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`, "i");
  return pattern.test(text);
}

export function extractSlashSkillSlugs(content: string): string[] {
  const slugs = new Set<string>();
  const pattern = /(?:^|\s)\/([a-z0-9][a-z0-9._-]{0,63})(?=$|\s|[.,;:!?)]|$)/gi;
  for (const match of content.matchAll(pattern)) {
    slugs.add(match[1].toLowerCase());
  }
  return Array.from(slugs);
}

function stripSlashSkillCalls(content: string): string {
  return content.replace(/(^|\s)\/([a-z0-9][a-z0-9._-]{0,63})(?=$|\s|[.,;:!?)]|$)/gi, " ");
}

function skillMatchesMessage(skill: GlobalSkillRecord, lowerContent: string, slashSlugs: Set<string>): boolean {
  if (slashSlugs.has(skill.slug)) return true;
  if (skill.trigger_phrases.some((phrase) => phrase && lowerContent.includes(phrase.toLowerCase()))) return true;
  if (skill.slug.length >= 3 && containsTerm(lowerContent, skill.slug)) return true;
  if (skill.name.length >= 3 && containsTerm(lowerContent, skill.name)) return true;
  return false;
}

function buildSkillPartsContext(skill: GlobalSkillRecord): string | null {
  if (skill.parts.length === 0) return null;

  const blocks: string[] = [];
  let usedChars = 0;
  for (const part of skill.parts) {
    const remaining = MAX_PARTS_TOTAL_CHARS - usedChars;
    if (remaining <= 0) break;
    const body = truncate(part.body_md, Math.min(MAX_PART_BODY_CHARS, remaining));
    usedChars += body.length;
    blocks.push([
      `<global_skill_part name="${escapeAttribute(part.name)}">`,
      body,
      "</global_skill_part>",
    ].join("\n"));
  }

  if (blocks.length === 0) return null;
  const omitted = skill.parts.length > blocks.length
    ? `\n\n[${skill.parts.length - blocks.length} named skill parts omitted due to prompt budget]`
    : "";
  return [
    "Named parts:",
    "These are trusted supporting instructions that the main skill may reference by name.",
    "",
    `${blocks.join("\n\n")}${omitted}`,
  ].join("\n");
}

function buildGlobalSkillsIndex(skills: GlobalSkillRecord[]): string {
  if (skills.length === 0) return "";
  const lines = skills.slice(0, MAX_INDEX_SKILLS).map((skill) => {
    const description = truncate(skill.description.replace(/\s+/g, " "), MAX_DESCRIPTION_CHARS);
    return `- /${skill.slug} — ${skill.name}: ${description}`;
  });
  const omitted = skills.length > MAX_INDEX_SKILLS
    ? `\n- ...and ${skills.length - MAX_INDEX_SKILLS} more global skills`
    : "";
  return [
    "## Archie Global Skills",
    "Admin-defined skills are available in every Archie session. If the latest user message calls a skill with `/slug` or clearly matches a trigger phrase, follow that skill's instructions.",
    "",
    "Available global skills:",
    `${lines.join("\n")}${omitted}`,
  ].join("\n");
}

function buildActiveSkillsContext(skills: GlobalSkillRecord[]): string {
  if (skills.length === 0) return "";
  const blocks = skills.slice(0, MAX_ACTIVE_SKILLS).map((skill) => [
    `<global_skill slug="${skill.slug}" name="${escapeAttribute(skill.name)}">`,
    `Description: ${skill.description}`,
    skill.trigger_phrases.length > 0 ? `Trigger phrases: ${skill.trigger_phrases.join("; ")}` : null,
    "",
    "Main instructions:",
    truncate(skill.body_md, MAX_BODY_CHARS),
    buildSkillPartsContext(skill),
    "</global_skill>",
  ].filter((line): line is string => line !== null).join("\n"));

  return [
    "## Active Global Skill Instructions",
    "The latest user message matched these trusted admin-defined skills. Apply them to the current request when compatible with higher-priority system and tool rules.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function buildUnavailableSkillContext(disabledSlashSlugs: string[]): string {
  if (disabledSlashSlugs.length === 0) return "";
  return [
    "## Unavailable Global Skill Calls",
    `The latest user message referenced disabled global skill ${disabledSlashSlugs.length === 1 ? "command" : "commands"}: ${disabledSlashSlugs.map((slug) => `/${slug}`).join(", ")}.`,
    "Do not apply disabled skill instructions. Treat those slash commands as plain user text unless the user asks to enable or edit that skill.",
  ].join("\n");
}

export function resolveGlobalSkillsForMessage(content: string): GlobalSkillRecord[] {
  const skills = dal.listGlobalSkills({ enabledOnly: true }).filter((skill) => skill.enabled);
  const lowerContent = stripSlashSkillCalls(content).toLowerCase();
  const slashSlugs = new Set(extractSlashSkillSlugs(content));
  return skills
    .filter((skill) => skillMatchesMessage(skill, lowerContent, slashSlugs))
    .slice(0, MAX_ACTIVE_SKILLS);
}

export function buildGlobalSkillPromptContext(content: string): GlobalSkillPromptContext {
  const allSkills = dal.listGlobalSkills();
  const skills = allSkills.filter((skill) => skill.enabled);
  const lowerContent = stripSlashSkillCalls(content).toLowerCase();
  const slashSlugs = new Set(extractSlashSkillSlugs(content));
  const activeSkills = skills
    .filter((skill) => skillMatchesMessage(skill, lowerContent, slashSlugs))
    .slice(0, MAX_ACTIVE_SKILLS);
  const disabledSkillSlugs = new Set(allSkills.filter((skill) => !skill.enabled).map((skill) => skill.slug));
  const disabledSlashSlugs = Array.from(slashSlugs).filter((slug) => disabledSkillSlugs.has(slug));

  const indexText = buildGlobalSkillsIndex(skills);
  const activeText = buildActiveSkillsContext(activeSkills);
  const unavailableText = buildUnavailableSkillContext(disabledSlashSlugs);
  const promptText = [indexText, activeText, unavailableText].filter(Boolean).join("\n\n");
  return { indexText, activeText, unavailableText, promptText, activeSkills, disabledSlashSlugs };
}
