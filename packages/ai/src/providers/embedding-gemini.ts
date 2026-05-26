import type { EmbeddingProvider } from "../embedding/types.js";

type GeminiEmbedRequest = {
  model: string;
  content: { parts: Array<{ text: string }> };
  taskType: "SEMANTIC_SIMILARITY";
};

type GeminiEmbedResponse = {
  embeddings?: Array<{ values: number[] }>;
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "gemini";
  readonly modelName: string;
  private readonly apiKey: string;

  constructor(opts: { apiKey: string; model: string }) {
    this.apiKey = opts.apiKey;
    this.modelName = opts.model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const requests: GeminiEmbedRequest[] = texts.map((text) => ({
      model: `models/${this.modelName}`,
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
    }));

    const url = `${GEMINI_API_BASE}/models/${this.modelName}:batchEmbedContents?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
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
