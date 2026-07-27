import { buildSummaryPrompt } from "./prompt.js";
import { validateSummaryResult } from "./validator.js";
import type { AIProvider, ThreadMessage } from "../types.js";
import type { SummaryContext } from "./prompt.js";
import type { SummaryResult } from "./validator.js";

export type { SummaryContext, SummaryResult };

/**
 * Generate a one-or-two-sentence TL;DR for a thread. Returns null on a provider
 * error or unparseable output; the caller marks the row FAILED and does NOT meter
 * the attempt.
 *
 * Never logs the prompt, the raw response, or the summary — all three are derived
 * email content. Length and duration only.
 */
export async function generateThreadSummary(
  provider: AIProvider,
  messages: ThreadMessage[],
  context: SummaryContext
): Promise<SummaryResult | null> {
  const promptMessages = buildSummaryPrompt(messages, context);
  let rawText: string;
  try {
    rawText = await provider.chat(promptMessages);
  } catch (e) {
    console.error(`[summary] LLM call failed: ${String(e)}`);
    return null;
  }
  console.log(`[summary] LLM responded (${rawText.length} chars)`);
  const result = validateSummaryResult(rawText);
  if (result) {
    console.log(`[summary] format=${result.format} bullets=${result.bullets.length}`);
  }
  return result;
}
