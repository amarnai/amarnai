import OpenAI from "openai";
import type { EmbeddingProvider } from "../embedding/types.js";

export class FrontierEmbeddingProvider implements EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  private readonly client: OpenAI;

  constructor(opts: { provider: string; apiKey: string; model: string; baseUrl?: string }) {
    this.providerName = opts.provider;
    this.modelName = opts.model;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.client.embeddings.create({
      model: this.modelName,
      input: texts,
    });

    // OpenAI returns embeddings in order but includes an index field for safety
    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
