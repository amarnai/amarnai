import type { AIProviderConfig, EmbeddingProviderConfig } from "./types.js";
import type { BatchProviderConfig } from "./batch/types.js";

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
  // Routing does not benefit from extended thinking (benchmarked: identical
  // accuracy, ~3x higher latency) and long thinking causes the Gemini
  // OpenAI-compat endpoint to drop the connection mid-response. Default to
  // disabling it; override with ROUTING_REASONING_EFFORT=low to re-enable a
  // bounded budget without a code change.
  if (cfg.frontier) {
    cfg.frontier = { ...cfg.frontier, reasoningEffort: parseReasoningEffort(process.env["ROUTING_REASONING_EFFORT"]) };
  }
  return cfg;
}

/**
 * Provider config for taxonomy generation. Deliberately NOT the routing model:
 * routing runs on the cheapest tier (e.g. gemini-2.5-flash-lite), which is the
 * most demand-throttled and routinely returns 503 UNAVAILABLE — fatal for a
 * one-shot, user-facing generation. Taxonomy is a richer generative task, so it
 * defaults to the capable frontier model (FRONTIER_LLM_MODEL) and can be pinned
 * independently with TAXONOMY_LLM_MODEL. Thinking is disabled by default for the
 * same reason as routing: long thinking drops the Gemini OpenAI-compat
 * connection mid-response (override with TAXONOMY_REASONING_EFFORT).
 */
export function getTaxonomyAIProviderConfig(): AIProviderConfig {
  const cfg = getAIProviderConfig();
  const taxonomyModel = process.env["TAXONOMY_LLM_MODEL"];
  const taxonomyOllamaModel = process.env["TAXONOMY_OLLAMA_MODEL"];
  if (taxonomyModel && cfg.frontier) cfg.frontier = { ...cfg.frontier, model: taxonomyModel };
  if (taxonomyOllamaModel && cfg.ollama) cfg.ollama = { ...cfg.ollama, model: taxonomyOllamaModel };
  if (cfg.frontier) {
    cfg.frontier = { ...cfg.frontier, reasoningEffort: parseReasoningEffort(process.env["TAXONOMY_REASONING_EFFORT"]) };
  }
  return cfg;
}

/** Parse a reasoning-effort env var; defaults to "none". */
function parseReasoningEffort(raw: string | undefined): "low" | "medium" | "high" | "none" {
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "none") return raw;
  return "none";
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

/**
 * Config for the async Batch-API provider (BACKFILL_BATCH_MODE). Composed from
 * the embedding + routing-LLM env so it reuses the same models/keys/dimension.
 * Resolves to "frontier" only when BOTH the embedding and LLM frontier providers
 * are Gemini-capable; otherwise "mock" (tests/dev). Callers gate batch mode on
 * `isBatchModeAvailable()` and fall back to the synchronous path when false.
 */
export function getBatchProviderConfig(): BatchProviderConfig {
  const embed = getEmbeddingProviderConfig();
  const llm = getRoutingAIProviderConfig();
  const embedProvider = embed.frontier?.provider ?? "gemini";
  const llmProvider = llm.frontier?.provider ?? "gemini";

  const frontierReady =
    embed.provider === "frontier" &&
    llm.provider === "frontier" &&
    embedProvider === "gemini" &&
    llmProvider === "gemini" &&
    !!embed.frontier?.apiKey &&
    !!embed.frontier?.model &&
    !!llm.frontier?.apiKey &&
    !!llm.frontier?.model;

  if (!frontierReady) return { provider: "mock" };

  const embedDimensions = parseDimensions(process.env["FRONTIER_EMBEDDING_DIMENSIONS"]);
  return {
    provider: "frontier",
    frontier: {
      embedApiKey: embed.frontier!.apiKey!,
      embedModel: embed.frontier!.model!,
      ...(embedDimensions ? { embedDimensions } : {}),
      ...(embed.frontier!.baseUrl ? { embedBaseUrl: embed.frontier!.baseUrl } : {}),
      llmApiKey: llm.frontier!.apiKey!,
      llmModel: llm.frontier!.model!,
      ...(llm.frontier!.baseUrl ? { llmBaseUrl: llm.frontier!.baseUrl } : {}),
    },
  };
}

/**
 * Whether async batch backfill should run. Gated on the BACKFILL_BATCH_MODE flag
 * AND a Gemini-capable frontier config. Hosted-only, off by default; self-host /
 * mock / Ollama fall through to the synchronous per-thread path.
 */
export function isBatchModeAvailable(): boolean {
  if (process.env["BACKFILL_BATCH_MODE"] !== "true") return false;
  return getBatchProviderConfig().provider === "frontier";
}
