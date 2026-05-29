import { buildDraftPrompt } from "./prompt.js";
import { validateDraftResult } from "./validator.js";
import type { AIProvider, ThreadMessage } from "../types.js";
import type { DraftContext } from "./prompt.js";
import type { DraftResult } from "./validator.js";

export type { DraftContext, DraftResult };

export async function generateDraft(
  provider: AIProvider,
  messages: ThreadMessage[],
  context: DraftContext
): Promise<DraftResult | null> {
  const promptMessages = buildDraftPrompt(messages, context);
  let rawText: string;
  try {
    rawText = await provider.chat(promptMessages);
  } catch (e) {
    console.error(`[draft] LLM call failed: ${String(e)}`);
    return null;
  }
  console.log(`[draft] LLM raw response (first 300 chars): ${rawText.slice(0, 300)}`);
  return validateDraftResult(rawText);
}
