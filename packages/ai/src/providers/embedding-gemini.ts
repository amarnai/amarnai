import type { EmbeddingProvider } from "../embedding/types.js";
import { composeEmbeddingModelId } from "../embedding/model-id.js";

type GeminiEmbedRequest = {
  model: string;
  content: { parts: Array<{ text: string }> };
  taskType: "SEMANTIC_SIMILARITY";
  /** Matryoshka (MRL) truncated output size. Omitted to use the model default. */
  outputDimensionality?: number;
};

type GeminiEmbedResponse = {
  embeddings?: Array<{ values: number[] }>;
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Thrown when the configured embedding model does not exist (HTTP 404). This is
 * a deployment misconfiguration, not a transient fault, so callers should fail
 * fast rather than retry.
 */
export class EmbeddingModelNotFoundError extends Error {
  constructor(model: string, body: string) {
    super(`Embedding model "${model}" not found (404): ${body}`);
    this.name = "EmbeddingModelNotFoundError";
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "gemini";
  /**
   * Identity used for staleness/hashing and persisted as `embeddingModel`.
   * Folds in the output dimension so a dimension change invalidates old vectors
   * exactly like a model change. NOT the value sent to the API.
   */
  readonly modelName: string;
  private readonly apiModel: string;
  private readonly apiKey: string;
  /**
   * Matryoshka output size (e.g. 768). When set, gemini-embedding-001 returns a
   * truncated, NON-normalized vector — fine for cosine similarity, which divides
   * by the vector norms. When undefined the model returns its default size.
   */
  private readonly dimensions: number | undefined;

  constructor(opts: { apiKey: string; model: string; dimensions?: number }) {
    this.apiKey = opts.apiKey;
    this.apiModel = opts.model;
    this.dimensions = opts.dimensions;
    this.modelName = composeEmbeddingModelId(opts.model, opts.dimensions);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const requests: GeminiEmbedRequest[] = texts.map((text) => ({
      model: `models/${this.apiModel}`,
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
      ...(this.dimensions ? { outputDimensionality: this.dimensions } : {}),
    }));

    const url = `${GEMINI_API_BASE}/models/${this.apiModel}:batchEmbedContents?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      if (res.status === 404) {
        throw new EmbeddingModelNotFoundError(this.apiModel, body);
      }
      throw new Error(`Gemini embedding error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as GeminiEmbedResponse;
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
      throw new Error(
        `Gemini batchEmbedContents returned ${data.embeddings?.length ?? 0} embeddings for ${texts.length} inputs`
      );
    }

    return data.embeddings.map((e) => e.values);
  }
}
