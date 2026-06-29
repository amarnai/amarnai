/**
 * Async Batch-API provider (BACKFILL_BATCH_MODE).
 *
 * Unlike the synchronous `EmbeddingProvider.embed` / `AIProvider.chat`, a batch
 * job is submit → poll → fetch: requests are sent in bulk, processed offline by
 * the provider (Gemini Batch API: ~50% of interactive price, up to 24h
 * turnaround), and results are fetched later. Used only for latency-tolerant
 * inbox backfill; real-time routing keeps the synchronous providers.
 *
 * Every request carries an opaque `key` (the caller sets
 * `<workspaceId>:<emailThreadId>:<step>`). Results are mapped back STRICTLY by
 * `key`, never by order — the provider may reorder, drop, or partially fail
 * requests. A null `vector`/`output` with an `error` marks a per-request failure
 * that the caller falls back to the online path.
 */

export type BatchEmbedRequest = { key: string; text: string };
export type BatchGenerateRequest = { key: string; system: string; user: string };

export type BatchSubmitResult = { providerJobId: string };

export type BatchPollStatus = "RUNNING" | "COMPLETED" | "FAILED" | "EXPIRED";

export type BatchEmbedResultItem = { key: string; vector: number[] | null; error?: string };
export type BatchGenerateResultItem = { key: string; output: string | null; error?: string };

/** Token usage is reported per batch (not per request) for cost attribution. */
export type BatchEmbedResults = {
  items: BatchEmbedResultItem[];
  inputTokens: number;
  outputTokens: number;
};
export type BatchGenerateResults = {
  items: BatchGenerateResultItem[];
  inputTokens: number;
  outputTokens: number;
};

export interface BatchProvider {
  readonly providerName: string;
  /** Embedding model identity (folds in dimension), mirrors EmbeddingProvider.modelName. */
  readonly embedModelName: string;
  /** LLM model identity, mirrors AIProvider.modelName. */
  readonly llmModelName: string;

  submitEmbeddings(reqs: BatchEmbedRequest[]): Promise<BatchSubmitResult>;
  submitGenerate(reqs: BatchGenerateRequest[]): Promise<BatchSubmitResult>;

  poll(providerJobId: string): Promise<BatchPollStatus>;

  fetchEmbeddingResults(providerJobId: string): Promise<BatchEmbedResults>;
  fetchGenerateResults(providerJobId: string): Promise<BatchGenerateResults>;
}

/**
 * Config for the batch provider. Composed from the existing embedding + routing
 * LLM configs so it inherits the same model/key/dimension plumbing. Only the
 * "frontier"/"gemini" path is supported; mock is used in tests, and ollama has
 * no batch API (callers fall back to the synchronous path when not frontier).
 */
export type BatchProviderConfig = {
  provider: "mock" | "frontier";
  frontier?: {
    embedApiKey?: string;
    embedModel?: string;
    embedDimensions?: number;
    embedBaseUrl?: string;
    llmApiKey?: string;
    llmModel?: string;
    llmBaseUrl?: string;
  };
};
