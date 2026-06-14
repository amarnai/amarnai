import OpenAI from "openai";
import type { EmbeddingProvider } from "../embedding/types.js";
import { composeEmbeddingModelId } from "../embedding/model-id.js";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerName: string;
  /**
   * Identity used for staleness/hashing and persisted as `embeddingModel`.
   * Folds in the output dimension so a dimension change invalidates old vectors
   * exactly like a model change. NOT the value sent to the API.
   */
  readonly modelName: string;
  private readonly apiModel: string;
  private readonly client: OpenAI;
  private readonly dimensions: number | undefined;

  constructor(opts: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
    dimensions?: number;
  }) {
    this.providerName = opts.provider;
    this.apiModel = opts.model;
    this.dimensions = opts.dimensions;
    this.modelName = composeEmbeddingModelId(opts.model, opts.dimensions);
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.client.embeddings.create({
      model: this.apiModel,
      input: texts,
      ...(this.dimensions ? { dimensions: this.dimensions } : {}),
    });

    if (response.data.length !== texts.length) {
      throw new Error(
        `OpenAI embeddings returned ${response.data.length} vectors for ${texts.length} inputs`
      );
    }

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((e) => e.embedding);
  }
}
