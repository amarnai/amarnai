import type { AIProviderConfig, EmbeddingProviderConfig } from "./types.js";

export function getAIProviderConfig(): AIProviderConfig {
  const cfg: AIProviderConfig = {
    provider: (process.env["AI_PROVIDER"] ?? "mock") as "mock" | "ollama" | "frontier",
  };
  const ollamaBase = process.env["OLLAMA_BASE_URL"];
  const ollamaModel = process.env["OLLAMA_MODEL"];
  if (ollamaBase ?? ollamaModel) {
    cfg.ollama = {
      ...(ollamaBase ? { baseUrl: ollamaBase } : {}),
      ...(ollamaModel ? { model: ollamaModel } : {}),
    };
  }
  const fProvider = process.env["FRONTIER_LLM_PROVIDER"];
  const fApiKey = process.env["FRONTIER_LLM_API_KEY"];
  const fModel = process.env["FRONTIER_LLM_MODEL"];
  const fBaseUrl = process.env["FRONTIER_LLM_BASE_URL"];
  if (fProvider ?? fApiKey ?? fModel ?? fBaseUrl) {
    cfg.frontier = {
      ...(fProvider ? { provider: fProvider } : {}),
      ...(fApiKey ? { apiKey: fApiKey } : {}),
      ...(fModel ? { model: fModel } : {}),
      ...(fBaseUrl ? { baseUrl: fBaseUrl } : {}),
    };
  }
  return cfg;
}

export function getEmbeddingProviderConfig(): EmbeddingProviderConfig {
  const provider = (process.env["EMBEDDING_PROVIDER"] ?? "mock") as "mock" | "ollama" | "frontier";
  const cfg: EmbeddingProviderConfig = { provider };
  const ollamaBase = process.env["OLLAMA_BASE_URL"];
  const ollamaEmbModel = process.env["OLLAMA_EMBEDDING_MODEL"];
  if (ollamaBase ?? ollamaEmbModel) {
    cfg.ollama = {
      ...(ollamaBase ? { baseUrl: ollamaBase } : {}),
      ...(ollamaEmbModel ? { model: ollamaEmbModel } : {}),
    };
  }
  const fProvider = process.env["FRONTIER_EMBEDDING_PROVIDER"];
  const fApiKey = process.env["FRONTIER_EMBEDDING_API_KEY"];
  const fModel = process.env["FRONTIER_EMBEDDING_MODEL"];
  const fBaseUrl = process.env["FRONTIER_EMBEDDING_BASE_URL"];
  if (fProvider ?? fApiKey ?? fModel ?? fBaseUrl) {
    cfg.frontier = {
      ...(fProvider ? { provider: fProvider } : {}),
      ...(fApiKey ? { apiKey: fApiKey } : {}),
      ...(fModel ? { model: fModel } : {}),
      ...(fBaseUrl ? { baseUrl: fBaseUrl } : {}),
    };
  }
  return cfg;
}
