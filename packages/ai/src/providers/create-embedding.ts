/**
 * Factory for `EmbeddingProvider` instances (vector embedding).
 *
 * Supported providers:
 *   - `"frontier"` — any external API (Gemini, OpenAI, or OpenAI-compatible)
 *   - `"ollama"` — local Ollama instance (dev)
 *
 * `"mock"` throws — use `createMockEmbeddingProvider()` from test utilities
 * instead, which returns deterministic fixed-dimension vectors.
 */
import { OllamaEmbeddingProvider } from "./embedding-ollama.js";
import { GeminiEmbeddingProvider } from "./embedding-gemini.js";
import { OpenAIEmbeddingProvider } from "./embedding-openai.js";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "../embedding/types.js";

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case "frontier": {
      const apiKey = config.frontier?.apiKey;
      const model = config.frontier?.model;
      const subProvider = config.frontier?.provider ?? "gemini";
      if (!apiKey) throw new Error("FRONTIER_EMBEDDING_API_KEY is required for frontier embedding provider");
      if (!model) throw new Error("FRONTIER_EMBEDDING_MODEL is required for frontier embedding provider");
      if (subProvider === "gemini") {
        return new GeminiEmbeddingProvider({ apiKey, model });
      }
      const baseUrl = config.frontier?.baseUrl;
      return new OpenAIEmbeddingProvider({
        provider: subProvider,
        apiKey,
        model,
        ...(baseUrl ? { baseUrl } : {}),
      });
    }
    case "ollama": {
      const baseUrl = config.ollama?.baseUrl;
      const model = config.ollama?.model;
      if (!baseUrl) throw new Error("OLLAMA_BASE_URL is required for ollama embedding provider");
      if (!model) throw new Error("OLLAMA_EMBEDDING_MODEL is required for ollama embedding provider");
      return new OllamaEmbeddingProvider(baseUrl, model);
    }
    case "mock":
      throw new Error(
        "EMBEDDING_PROVIDER is set to 'mock'. Use createMockEmbeddingProvider() for tests."
      );
    default: {
      const got = (config as { provider: string }).provider;
      throw new Error(
        `EMBEDDING_PROVIDER must be 'frontier' or 'ollama'${got ? `, got '${got}'` : " (not set)"}.`
      );
    }
  }
}
