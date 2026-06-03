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
};

export type TaxonomyNodeInput = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  examples: string[];
  isRoot: boolean;
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
  };
};

export type EmbeddingProviderConfig = {
  provider: "mock" | "ollama" | "gemini";
  ollama?: {
    baseUrl?: string;
    model?: string;
  };
  gemini?: {
    apiKey?: string;
    model?: string;
  };
};
