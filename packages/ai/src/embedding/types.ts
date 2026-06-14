import type { TaxonomyNodeInput } from "../types.js";

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
    /** Which embedding API to call: "gemini" or any OpenAI-compatible provider. */
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    /**
     * Output vector size. Gemini (Matryoshka) and OpenAI text-embedding-3 both
     * support truncating the embedding to a smaller dimension. Omit to use the
     * model default. The chosen value is folded into the model identity so a
     * change re-embeds stored vectors. See composeEmbeddingModelId.
     */
    dimensions?: number;
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
