import type { TaxonomyNodeInput } from "./types.js";

// ─── Provider interface ────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  /** Embed one or more texts. Returns one vector per input text, in order. */
  embed(texts: string[]): Promise<number[][]>;
}

// ─── Provider config ───────────────────────────────────────────────────────────

export type EmbeddingProviderConfig = {
  provider: "mock" | "ollama" | "frontier";
  ollama?: {
    baseUrl?: string;
    model?: string;
  };
  frontier?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
};

// ─── Node types ────────────────────────────────────────────────────────────────

/** TaxonomyNode enriched with optional persisted embedding fields from DB. */
export type EmbeddableNode = TaxonomyNodeInput & {
  embeddingVector?: number[] | null;
  embeddingModel?: string | null;
  embeddingTextHash?: string | null;
};

/** Embedding update record the caller persists to the DB after sorting. */
export type UpdatedNodeEmbedding = {
  nodeId: string;
  embeddingVector: number[];
  embeddingModel: string;
  embeddingTextHash: string;
  embeddingUpdatedAt: Date;
};
