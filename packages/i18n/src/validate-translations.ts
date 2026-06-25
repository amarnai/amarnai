import { z } from "zod";

export type TranslationEntry = { msgid: string };

// Extract ICU argument placeholders as {name} tokens, ignoring the literal text
// inside plural/select sub-messages. A naive /\{(\w+)/ regex wrongly treats the
// first word of an arm (e.g. `one {Deleting this folder...}`) as a placeholder,
// which makes valid translations fail validation. We walk the ICU structure
// instead, capturing only true argument references (including those nested
// inside arms) — e.g. {count, plural, one {# item} other {# items}} -> {count},
// and {count, plural, one {# for {name}}} -> {count}, {name}.
//
// NOTE: this logic is duplicated in scripts/i18n-translate.mjs (which cannot
// import TS); keep the two in sync.
export function extractPlaceholders(str: string): Set<string> {
  const placeholders = new Set<string>();
  const n = str.length;
  let i = 0;

  const isWord = (c: string): boolean => /\w/.test(c);
  const skipSpace = (): void => {
    while (i < n && /\s/.test(str.charAt(i))) i++;
  };

  // Consume a message body until the closing `}` of its enclosing arm/argument
  // (or end of input). Nested arguments are parsed in place.
  const parseMessage = (): void => {
    while (i < n) {
      const c = str.charAt(i);
      if (c === "}") return;
      if (c === "{") {
        parseArgument();
        continue;
      }
      i++;
    }
  };

  // At a `{`: read the argument name, then any plural/select arms.
  const parseArgument = (): void => {
    i++; // consume `{`
    skipSpace();
    const start = i;
    while (i < n && isWord(str.charAt(i))) i++;
    const name = str.slice(start, i);
    if (name) placeholders.add(`{${name}}`);
    skipSpace();
    if (str.charAt(i) === ",") {
      i++; // consume `,`
      skipSpace();
      const typeStart = i;
      while (i < n && isWord(str.charAt(i))) i++;
      const type = str.slice(typeStart, i);
      if (type === "plural" || type === "select" || type === "selectordinal") {
        skipSpace();
        if (str.charAt(i) === ",") i++;
        parseArms();
      } else {
        skipStyle(); // number/date/time/custom: skip to this argument's `}`
      }
    }
    if (str.charAt(i) === "}") i++; // consume the argument's closing `}`
  };

  // Parse `selector {message}` pairs until the argument's closing `}`.
  const parseArms = (): void => {
    while (i < n) {
      skipSpace();
      if (i >= n || str.charAt(i) === "}") return;
      // selector token (one, other, =0, custom identifier)
      while (i < n && !/\s/.test(str.charAt(i)) && str.charAt(i) !== "{" && str.charAt(i) !== "}") i++;
      skipSpace();
      if (str.charAt(i) !== "{") return; // malformed — bail
      i++; // consume arm `{`
      parseMessage(); // arm body, may contain nested arguments
      if (str.charAt(i) === "}") i++; // consume arm `}`
    }
  };

  // Skip a simple argument style up to its closing `}`, honoring nesting.
  const skipStyle = (): void => {
    let depth = 0;
    while (i < n) {
      const c = str.charAt(i);
      if (c === "{") depth++;
      else if (c === "}") {
        if (depth === 0) return;
        depth--;
      }
      i++;
    }
  };

  parseMessage();
  return placeholders;
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
