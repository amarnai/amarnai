import { z } from "zod";
import { extractJSON } from "../json-util.js";

export type SummaryResult = {
  summary: string;
};

/**
 * Hard cap on the stored summary text. The prompt asks for one or two sentences;
 * this bounds what a misbehaving model can persist into a row that is rendered
 * inside a fixed preview slot.
 */
export const MAX_SUMMARY_CHARS = 600;

const LLMSummarySchema = z.object({
  summary: z.string().min(1),
});

/**
 * Parse and normalize an LLM summary response.
 *
 * Logging here is deliberately stricter than the draft validator's: the summary IS
 * derived email content, so on failure we log the error and the raw length only —
 * never a preview of the text.
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

  const collapsed = result.data.summary.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    console.error("[summary-validator] LLM returned an empty summary after normalization");
    return null;
  }

  return { summary: collapsed.slice(0, MAX_SUMMARY_CHARS) };
}
