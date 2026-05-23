import type { EmbeddingProvider } from "../embedding-types.js";

type OllamaEmbedResponse = {
  embeddings?: number[][];
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "ollama";
  readonly modelName: string;
  private readonly baseUrl: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.modelName = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.modelName, input: texts }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      throw new Error(`Ollama embedding error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as OllamaEmbedResponse;
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
      throw new Error(
        `Ollama embed returned ${data.embeddings?.length ?? 0} vectors for ${texts.length} inputs`
      );
    }
    return data.embeddings;
  }
}
