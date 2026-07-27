import { z } from "zod";
import { extractJSON } from "../json-util.js";
import { MAX_BULLETS, MAX_BULLET_CHARS } from "./prompt.js";

export type SummaryFormat = "PROSE" | "BULLETS";

/**
 * Normalized summary output. Flat rather than a discriminated union because it
 * maps 1:1 onto the ThreadSummary row (`format` + `summary` + `bullets`) and
 * onto the three renderers, so the shape never has to be translated in between.
 * Exactly one of `text` / `bullets` is populated, per `format`.
 */
export type SummaryResult = {
  format: SummaryFormat;
  text: string | null;
  bullets: string[];
};

/**
 * Hard cap on the stored prose text. The prompt asks for one or two sentences;
 * this bounds what a misbehaving model can persist into a row that is rendered
 * inside a fixed preview slot.
 */
export const MAX_SUMMARY_CHARS = 600;

export { MAX_BULLETS, MAX_BULLET_CHARS };

// Both keys are optional: the model is told to send exactly one, and the reader
// below decides which it actually sent rather than trusting it to comply.
const LLMSummarySchema = z.object({
  summary: z.string().optional(),
  bullets: z.array(z.string()).optional(),
});

/** Collapse whitespace and strip any bullet glyph the model prefixed anyway. */
function clean(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^\s*[-•*•]\s*/, "")
    .trim();
}

/**
 * Parse and normalize an LLM summary response, in either the prose or the
 * bullets shape.
 *
 * Logging here is deliberately stricter than the draft validator's: the summary
 * IS derived email content, so on failure we log the error and the raw length
 * only — never a preview of the text.
 */
export function validateSummaryResult(rawText: string): SummaryResult | null {
  let parsed: unknown;
  try {
    parsed = extractJSON(rawText);
  } catch (e) {
    console.error(
      `[summary-validator] Failed to parse LLM output as JSON: ${String(e)} (raw length: ${rawText.length})`
    );
    return null;
  }

  const result = LLMSummarySchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `[summary-validator] LLM summary schema validation failed: ${result.error.message} (raw length: ${rawText.length})`
    );
    return null;
  }

  // Bullets win when present and non-empty: a model that sends both has already
  // decided the thread is enumerable, and the richer shape is the useful one.
  const bullets = (result.data.bullets ?? [])
    .map(clean)
    .filter((b) => b.length > 0)
    .slice(0, MAX_BULLETS)
    .map((b) => b.slice(0, MAX_BULLET_CHARS));

  if (bullets.length > 0) {
    // A single bullet is a sentence wearing a costume — render it as prose.
    if (bullets.length === 1) {
      return { format: "PROSE", text: bullets[0]!.slice(0, MAX_SUMMARY_CHARS), bullets: [] };
    }
    return { format: "BULLETS", text: null, bullets };
  }

  const text = clean(result.data.summary ?? "");
  if (text.length === 0) {
    console.error("[summary-validator] LLM returned neither bullets nor a summary");
    return null;
  }

  return { format: "PROSE", text: text.slice(0, MAX_SUMMARY_CHARS), bullets: [] };
}
