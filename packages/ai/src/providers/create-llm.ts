/**
 * Factory for `AIProvider` instances (LLM chat completion).
 *
 * Supported providers: `"ollama"` (local) and `"frontier"` (API-based).
 * `"mock"` throws intentionally — use a hand-rolled `AIProvider` stub in tests
 * rather than a provider instance, to keep tests fast and offline.
 */
import { FrontierAIProvider } from "./frontier.js";
import { OllamaAIProvider } from "./ollama.js";
import type { AIProvider, AIProviderConfig } from "../types.js";

export function createAIProvider(config: AIProviderConfig): AIProvider {
  switch (config.provider) {
    case "ollama": {
      const baseUrl = config.ollama?.baseUrl;
      const model = config.ollama?.model;
      if (!baseUrl) throw new Error("OLLAMA_BASE_URL is required for ollama provider");
      if (!model) throw new Error("OLLAMA_MODEL is required for ollama provider");
      return new OllamaAIProvider(baseUrl, model);
    }
    case "frontier": {
      const provider = config.frontier?.provider;
      const apiKey = config.frontier?.apiKey;
      const model = config.frontier?.model;
      if (!provider) throw new Error("FRONTIER_LLM_PROVIDER is required for frontier provider");
      if (!apiKey) throw new Error("FRONTIER_LLM_API_KEY is required for frontier provider");
      if (!model) throw new Error("FRONTIER_LLM_MODEL is required for frontier provider");
      const baseUrl = config.frontier?.baseUrl;
      const reasoningEffort = config.frontier?.reasoningEffort;
      return new FrontierAIProvider({
        provider,
        apiKey,
        model,
        ...(baseUrl ? { baseUrl } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      });
    }
    case "mock":
      throw new Error(
        "AI_PROVIDER is set to 'mock'. Set AI_PROVIDER=ollama or AI_PROVIDER=frontier to use AI classification."
      );
  }
}
