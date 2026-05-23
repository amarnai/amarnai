import { FrontierEmbeddingProvider } from "./providers/embedding-frontier.js";
import { OllamaEmbeddingProvider } from "./providers/embedding-ollama.js";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "./embedding-types.js";

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case "ollama": {
      const baseUrl = config.ollama?.baseUrl;
      const model = config.ollama?.model;
      if (!baseUrl) throw new Error("OLLAMA_BASE_URL is required for ollama embedding provider");
      if (!model) throw new Error("OLLAMA_EMBEDDING_MODEL is required for ollama embedding provider");
      return new OllamaEmbeddingProvider(baseUrl, model);
    }
    case "frontier": {
      const apiKey = config.frontier?.apiKey;
      const model = config.frontier?.model;
      if (!apiKey) throw new Error("FRONTIER_EMBEDDING_API_KEY is required for frontier embedding provider");
      if (!model) throw new Error("FRONTIER_EMBEDDING_MODEL is required for frontier embedding provider");
      return new FrontierEmbeddingProvider({
        provider: "frontier",
        apiKey,
        model,
        ...(config.frontier?.baseUrl ? { baseUrl: config.frontier.baseUrl } : {}),
      });
    }
    case "mock":
      throw new Error(
        "EMBEDDING_PROVIDER is set to 'mock'. Use createMockEmbeddingProvider() for tests."
      );
  }
}
