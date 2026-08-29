/**
 * Core type definitions for the @amarnai/ai package.
 *
 * The classification pipeline:
 *   embedding-sorter.ts → candidate-selector.ts →
 *   candidate-path-prompt.ts → candidate-path-validator.ts
 *
 * Embedding preselection narrows the taxonomy to a short candidate list;
 * the LLM selects among opaque `candidate_N` identifiers. The model never
 * sees raw node or edge IDs, preventing hallucination.
 *
 * The result is `EmbeddingSortResult` (see embedding-sorter.ts).
 */

// ─── Input types ───────────────────────────────────────────────────────────────

export type ThreadMessage = {
  subject: string | null;
  senderEmail: string;
  senderName: string | null;
  bodyText: string | null;
  receivedAt: Date | string;
  attachmentNames?: string[];
};

export type TaxonomyNodeInput = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  examples: string[];
  isRoot: boolean;
  /**
   * A non-routable catch-all destination ("Updates / Other"). Excluded from all
   * embedding/LLM competition; assigned only by the automated-mail policy.
   * Optional: absent/false means a normal routable node.
   */
  isCatchAll?: boolean;
};

export type TaxonomyEdgeInput = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
};

// ─── Provider interface ────────────────────────────────────────────────────────

export interface AIProvider {
  readonly providerName: string;
  readonly modelName: string;
  chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string>;
}

/**
 * Optional wrapper around a paid LLM call that lets a caller deduplicate the
 * call across retries (e.g. a worker keying on its BullMQ jobId). Given a
 * `step` discriminator and a `compute` thunk returning the raw model response,
 * it returns either a freshly computed or a replayed-from-cache raw string.
 *
 * The ai package only declares this shape; the implementation (and any Redis /
 * job-context concerns) lives in the caller, so the ai package stays
 * infrastructure-agnostic. Callers must still validate the returned raw string
 * before trusting it — the cache holds only untrusted model output.
 */
export type LlmCallMemoizer = (
  step: string,
  compute: () => Promise<string>
) => Promise<string>;

// ─── Provider config ───────────────────────────────────────────────────────────

export type AIProviderConfig = {
  provider: "mock" | "ollama" | "frontier";
  ollama?: {
    baseUrl?: string;
    model?: string;
  };
  frontier?: {
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    /**
     * Thinking budget for reasoning-capable models (e.g. Gemini 2.5). "none"
     * disables thinking. Used for routing, where extended thinking adds latency
     * (and connection-drop risk on the Gemini OpenAI-compat endpoint) without
     * improving classification accuracy.
     */
    reasoningEffort?: "low" | "medium" | "high" | "none";
  };
};
