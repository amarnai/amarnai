import { buildCandidatePathPrompt } from "./candidate-path-prompt.js";
import { validatePathSelection } from "./candidate-path-validator.js";
import type { AIProvider, ThreadMessage } from "./types.js";
import type { CandidatePath } from "./candidate-selector.js";
import type { PathSelectionContext } from "./candidate-path-prompt.js";
import type { PathSelectionResult } from "./candidate-path-validator.js";

export async function selectPathFromCandidates(
  provider: AIProvider,
  emailThread: { messages: ThreadMessage[] },
  candidates: CandidatePath[],
  context?: PathSelectionContext
): Promise<PathSelectionResult> {
  const messages = buildCandidatePathPrompt(emailThread, candidates, context);
  const rawText = await provider.chat(messages);
  return validatePathSelection(rawText, candidates);
}
