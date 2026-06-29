/**
 * Deferred-LLM seam for batch routing (BACKFILL_BATCH_MODE).
 *
 * `sortThreadByEmbedding` already takes an `llmProvider` plus an optional
 * `llmMemoizer`. We exploit that to run routing OFFLINE without touching the
 * sorter: a synthetic provider + memoizer either
 *   - replays a previously-fetched batch answer for an escalation `step`, so the
 *     traversal continues deterministically, or
 *   - on the first un-answered escalation, records the built prompt and throws
 *     `DeferLlmSignal`, which propagates out of the sorter (the escalation catch
 *     rethrows when `failOpenOnLlmError` is false — the batch default).
 *
 * The caller (route-batch) runs the sorter once per round: a final result means
 * routing resolved; a thrown `DeferLlmSignal` means `ctx.pending` holds the one
 * new request to add to the LLM batch. Re-running with the accumulated answers
 * advances sole-child chains one escalation per round — no traversal-state
 * snapshotting. Replayed answers are still validated by `validateNodeSelection`.
 */
import type { AIProvider, LlmCallMemoizer } from "../types.js";

export class DeferLlmSignal extends Error {
  constructor() {
    super("LLM escalation deferred to batch");
    this.name = "DeferLlmSignal";
  }
}

export type DeferredLlmRequest = { step: string; system: string; user: string };

export type DeferredLlmContext = {
  llmProvider: AIProvider;
  llmMemoizer: LlmCallMemoizer;
  /** Holds the single recorded request when the sorter throws DeferLlmSignal. */
  pending: DeferredLlmRequest[];
};

function splitPrompt(messages: Array<{ role: string; content: string }>): {
  system: string;
  user: string;
} {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n\n");
  return { system, user };
}

/**
 * Build the provider + memoizer pair for one thread's batch routing pass.
 * `answers` maps escalation `step` → raw model answer accumulated across rounds.
 */
export function createDeferredLlmContext(answers: Map<string, string>): DeferredLlmContext {
  const pending: DeferredLlmRequest[] = [];
  // The memoizer knows the escalation `step`; the provider knows the built
  // prompt. Bridge them: the memoizer stamps the current step right before
  // invoking compute (which calls the provider synchronously within this await).
  let currentStep = "";

  const llmProvider: AIProvider = {
    providerName: "batch-deferred",
    modelName: "batch-deferred",
    async chat(messages) {
      const { system, user } = splitPrompt(messages);
      pending.push({ step: currentStep, system, user });
      throw new DeferLlmSignal();
    },
  };

  const llmMemoizer: LlmCallMemoizer = async (step, compute) => {
    const answer = answers.get(step);
    if (answer !== undefined) return answer; // replay → validated by the sorter
    currentStep = step;
    return compute(); // → llmProvider.chat → records + throws DeferLlmSignal
  };

  return { llmProvider, llmMemoizer, pending };
}
