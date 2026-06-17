/**
 * Thin orchestrator for the candidate-node LLM selection step.
 *
 * Builds the prompt (candidate-path-prompt.ts), calls the provider, and
 * validates the response (candidate-path-validator.ts). Used by both
 * `sortThreadByEmbedding` (embedding pipeline) and the standalone
 * `/dev/…/llm-path-selection` debug endpoint.
 *
 * Returns `NodeSelectionResult` with `finalNodeId`. Path reconstruction
 * (breadcrumbs, ClassificationPathStep[]) is the caller's responsibility
 * and should happen after node selection using the taxonomy graph.
 */
import { buildCandidateNodePrompt } from "./prompt.js";
import { validateNodeSelection } from "./validator.js";
import type { AIProvider, ThreadMessage, LlmCallMemoizer } from "../types.js";
import type { CandidateNode } from "./candidate-selector.js";
import type { NodeSelectionContext } from "./prompt.js";
import type { NodeSelectionResult } from "./validator.js";

export async function selectNodeFromCandidates(
  provider: AIProvider,
  emailThread: { messages: ThreadMessage[] },
  candidates: CandidateNode[],
  context?: NodeSelectionContext,
  // Optional retry-dedup wrapper for the paid `provider.chat` call. When
  // supplied (by the worker), a repeated attempt of the same job replays the
  // cached raw LLM response instead of re-calling the model. The cache holds
  // only the untrusted raw string; validateNodeSelection below still runs on
  // every code path, so a cache hit is validated identically to a fresh call.
  memo?: { memoize: LlmCallMemoizer; step: string }
): Promise<NodeSelectionResult> {
  const messages = buildCandidateNodePrompt(emailThread, candidates, context);
  const rawText = memo
    ? await memo.memoize(memo.step, () => provider.chat(messages))
    : await provider.chat(messages);
  return validateNodeSelection(rawText, candidates);
}
