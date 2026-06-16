import { normalizeGlobalSkillParts, normalizeGlobalSkillSlug, normalizeTriggerPhrases, type GlobalSkillWriteInput } from "./dal/global-skills";
import { RouteInputError } from "./room-route-utils";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_BODY_LENGTH = 16000;

function parseStringField(body: Record<string, unknown>, key: string, opts: { required?: boolean; maxLength: number }): string | undefined {
  const value = body[key];
  if (value === undefined) {
    if (opts.required) throw new RouteInputError(`${key} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new RouteInputError(`${key} must be a string`);
  const trimmed = value.trim();
  if (opts.required && !trimmed) throw new RouteInputError(`${key} is required`);
  if (trimmed.length > opts.maxLength) throw new RouteInputError(`${key} is too long`);
  return trimmed;
}

function parseBooleanField(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new RouteInputError(`${key} must be a boolean`);
  return value;
}

function parseTriggers(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    return normalizeTriggerPhrases(value.split("\n"));
  }
  if (!Array.isArray(value)) throw new RouteInputError("trigger_phrases must be an array");
  return normalizeTriggerPhrases(value);
}

function parseParts(value: unknown): GlobalSkillWriteInput["parts"] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new RouteInputError("parts must be an array");
  return normalizeGlobalSkillParts(value);
}

export function parseGlobalSkillPayload(
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {},
): GlobalSkillWriteInput {
  const partial = opts.partial === true;
  const rawSlug = parseStringField(body, "slug", { required: !partial, maxLength: 80 });
  const slug = rawSlug === undefined ? undefined : normalizeGlobalSkillSlug(rawSlug);
  if (slug !== undefined && !SLUG_PATTERN.test(slug)) {
    throw new RouteInputError("slug must use letters, numbers, dots, underscores, or hyphens");
  }

  const name = parseStringField(body, "name", { required: !partial, maxLength: MAX_NAME_LENGTH });
  const description = parseStringField(body, "description", { required: !partial, maxLength: MAX_DESCRIPTION_LENGTH });
  const bodyMd = parseStringField(body, "body_md", { required: !partial, maxLength: MAX_BODY_LENGTH });
  const parts = parseParts(body.parts);
  const triggerPhrases = parseTriggers(body.trigger_phrases);
  const enabled = parseBooleanField(body, "enabled");

  if (!partial && triggerPhrases === undefined) {
    throw new RouteInputError("trigger_phrases is required");
  }

  return {
    ...(slug !== undefined ? { slug } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(bodyMd !== undefined ? { body_md: bodyMd } : {}),
    ...(parts !== undefined ? { parts } : {}),
    ...(triggerPhrases !== undefined ? { trigger_phrases: triggerPhrases } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
  };
}

export function parseGlobalSkillRouteSlug(value: string): string {
  const slug = normalizeGlobalSkillSlug(value);
  if (!SLUG_PATTERN.test(slug)) throw new RouteInputError("Skill not found", 404);
  return slug;
}
