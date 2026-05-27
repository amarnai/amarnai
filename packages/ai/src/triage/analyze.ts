/**
 * Thin orchestrator for the triage metadata analysis step.
 *
 * Builds the triage prompt, calls the AI provider, and validates the response.
 * Returns `TriageMetadata | null` — null means the LLM failed or returned
 * invalid output, which is treated as "metadata unavailable" by callers.
 * A triage failure must never break the classification pipeline.
 */
import { buildTriagePrompt } from "./prompt.js";
import { validateTriageMetadata } from "./validator.js";
import type { AIProvider, ThreadMessage } from "../types.js";
import type { TriageMetadata } from "./validator.js";

export type { TriageMetadata };

export async function analyzeThreadTriage(
  provider: AIProvider,
  messages: ThreadMessage[]
): Promise<TriageMetadata | null> {
  const promptMessages = buildTriagePrompt(messages);
  let rawText: string;
  try {
    rawText = await provider.chat(promptMessages);
  } catch (e) {
    console.error(`[triage] LLM call failed: ${String(e)}`);
    return null;
  }
  console.log(`[triage] LLM raw response (first 300 chars): ${rawText.slice(0, 300)}`);
  return validateTriageMetadata(rawText);
}
