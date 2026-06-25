import { z } from "zod";

export type TranslationEntry = { msgid: string };

// Extract ICU variable identifiers as {name} tokens.
// Uses just the identifier part so nested-brace ICU plurals like
// {count, plural, one {# item} other {# items}} resolve to {count}.
export function extractPlaceholders(str: string): Set<string> {
  const matches = [...str.matchAll(/\{(\w+)/g)];
  return new Set(matches.map((m) => `{${m[1]}}`));
}

export function buildTranslationSchema(
  entries: TranslationEntry[]
): z.ZodObject<Record<string, z.ZodString>> {
  const shape: Record<string, z.ZodString> = {};
  for (const { msgid } of entries) {
    shape[msgid] = z.string().min(1);
  }
  return z.object(shape).strict() as z.ZodObject<Record<string, z.ZodString>>;
}

export type ValidationResult =
  | { ok: true; data: Record<string, string> }
  | { ok: false; error: string };

export function validateTranslations(
  raw: unknown,
  entries: TranslationEntry[]
): ValidationResult {
  const schema = buildTranslationSchema(entries);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  for (const { msgid } of entries) {
    const sourcePlaceholders = extractPlaceholders(msgid);
    const translation = parsed.data[msgid] ?? "";
    const translationPlaceholders = extractPlaceholders(translation);
    for (const ph of sourcePlaceholders) {
      if (!translationPlaceholders.has(ph)) {
        return {
          ok: false,
          error: `Placeholder ${ph} missing from translation of: "${msgid.slice(0, 60)}"`,
        };
      }
    }
  }

  return { ok: true, data: parsed.data };
}
