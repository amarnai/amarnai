/**
 * Factory for `EmbeddingProvider` instances (vector embedding).
 *
 * Supported providers:
 *   - `"gemini"` — Google Gemini (production)
 *   - `"ollama"` — local Ollama instance (dev)
 *
 * `"mock"` throws — use `createMockEmbeddingProvider()` from test utilities
 * instead, which returns deterministic fixed-dimension vectors.
 */
import { OllamaEmbeddingProvider } from "./embedding-ollama.js";
import { GeminiEmbeddingProvider } from "./embedding-gemini.js";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "../embedding/types.js";

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case "gemini": {
      const apiKey = config.gemini?.apiKey;
      const model = config.gemini?.model;
      if (!apiKey) throw new Error("GEMINI_EMBEDDING_API_KEY is required for gemini embedding provider");
      if (!model) throw new Error("GEMINI_EMBEDDING_MODEL is required for gemini embedding provider");
      return new GeminiEmbeddingProvider({ apiKey, model });
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
        `EMBEDDING_PROVIDER must be 'gemini' or 'ollama'${got ? `, got '${got}'` : " (not set)"}.`
      );
    }
  }
}
