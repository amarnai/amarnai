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

export function getRoutingAIProviderConfig(): AIProviderConfig {
  const cfg = getAIProviderConfig();
  const routingModel = process.env["ROUTING_LLM_MODEL"];
  const routingOllamaModel = process.env["ROUTING_OLLAMA_MODEL"];
  if (routingModel && cfg.frontier) cfg.frontier = { ...cfg.frontier, model: routingModel };
  if (routingOllamaModel && cfg.ollama) cfg.ollama = { ...cfg.ollama, model: routingOllamaModel };
  return cfg;
}

export function getDraftAIProviderConfig(): AIProviderConfig {
  const cfg = getAIProviderConfig();
  const draftModel = process.env["DRAFT_LLM_MODEL"];
  const draftOllamaModel = process.env["DRAFT_OLLAMA_MODEL"];
  if (draftModel && cfg.frontier) cfg.frontier = { ...cfg.frontier, model: draftModel };
  if (draftOllamaModel && cfg.ollama) cfg.ollama = { ...cfg.ollama, model: draftOllamaModel };
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
  const fDimensions = parseDimensions(process.env["FRONTIER_EMBEDDING_DIMENSIONS"]);
  if (fProvider ?? fApiKey ?? fModel ?? fBaseUrl ?? fDimensions) {
    cfg.frontier = {
      ...(fProvider ? { provider: fProvider } : {}),
      ...(fApiKey ? { apiKey: fApiKey } : {}),
      ...(fModel ? { model: fModel } : {}),
      ...(fBaseUrl ? { baseUrl: fBaseUrl } : {}),
      ...(fDimensions ? { dimensions: fDimensions } : {}),
    };
  }
  return cfg;
}

/** Parse a positive-integer dimension env var; returns undefined when unset or invalid. */
function parseDimensions(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
