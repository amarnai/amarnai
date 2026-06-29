/**
 * Factory for `BatchProvider` instances (async Batch API).
 *
 *   - `"frontier"` → GeminiBatchProvider (the only batch-capable frontier path).
 *   - `"mock"` → MockBatchProvider (tests / local dev).
 *
 * Ollama has no batch API; callers detect a non-frontier config upstream and
 * fall back to the synchronous online path rather than constructing this.
 */
import { GeminiBatchProvider } from "./batch-gemini.js";
import { MockBatchProvider } from "./batch-mock.js";
import type { BatchProvider, BatchProviderConfig } from "../batch/types.js";

export function createBatchProvider(config: BatchProviderConfig): BatchProvider {
  switch (config.provider) {
    case "frontier": {
      const f = config.frontier;
      if (!f?.embedApiKey) throw new Error("FRONTIER_EMBEDDING_API_KEY is required for the batch provider");
      if (!f.embedModel) throw new Error("FRONTIER_EMBEDDING_MODEL is required for the batch provider");
      if (!f.llmApiKey) throw new Error("FRONTIER_LLM_API_KEY is required for the batch provider");
      if (!f.llmModel) throw new Error("FRONTIER_LLM_MODEL is required for the batch provider");
      const subProvider = "gemini";
      if (subProvider !== "gemini") {
        throw new Error("Only the Gemini batch provider is supported");
      }
      return new GeminiBatchProvider({
        embedApiKey: f.embedApiKey,
        embedModel: f.embedModel,
        ...(f.embedDimensions ? { embedDimensions: f.embedDimensions } : {}),
        llmApiKey: f.llmApiKey,
        llmModel: f.llmModel,
      });
    }
    case "mock":
      return new MockBatchProvider();
    default: {
      const got = (config as { provider: string }).provider;
      throw new Error(`Batch provider must be 'frontier' or 'mock'${got ? `, got '${got}'` : ""}.`);
    }
  }
}
