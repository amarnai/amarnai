export type { AIProvider, AIProviderConfig, TaxonomyNodeInput, TaxonomyEdgeInput, ThreadMessage, LlmCallMemoizer } from "./types.js";
export { getAIProviderConfig, getRoutingAIProviderConfig, getTaxonomyAIProviderConfig, getDraftAIProviderConfig, getEmbeddingProviderConfig } from "./config.js";
export { createAIProvider } from "./providers/create-llm.js";
export { LLMAuthenticationError, LLMRequestError } from "./providers/frontier.js";
export { selectCandidateNodes, tokenize, MAX_CANDIDATE_PATHS } from "./selection/candidate-selector.js";
export type { EmailInput, CandidateNode, CandidateNodeResult } from "./selection/candidate-selector.js";
export { buildCandidateNodePrompt } from "./selection/prompt.js";
export type { NodeSelectionContext } from "./selection/prompt.js";
export { validateNodeSelection, MIN_LLM_NODE_CONFIDENCE } from "./selection/validator.js";
export type { NodeSelectionResult } from "./selection/validator.js";
export { selectNodeFromCandidates } from "./selection/select-path.js";
export type { ThreadSnapshot, SnapshotMessage, AttachmentMeta } from "./thread-snapshot.js";
export { snapshotToThreadMessages } from "./thread-snapshot.js";
// ─── Embedding ────────────────────────────────────────────────────────────────
export type { EmbeddingProvider, EmbeddingProviderConfig, EmbeddableNode, UpdatedNodeEmbedding } from "./embedding/types.js";
export { createEmbeddingProvider } from "./providers/create-embedding.js";
export { EmbeddingModelNotFoundError } from "./providers/embedding-gemini.js";
export {
  cosineSimilarity,
  softmax,
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
  computeSubtreeScores,
  deriveBreadcrumb,
  findDescendants,
  getStaleEmbeddableNodes,
} from "./embedding/math.js";
export {
  sortThreadByEmbedding,
  CENTERED_ROUTING_CONFIG,
  THETA_MIN,
  LAMBDA_DEPTH_DECAY,
  SOFTMAX_TEMPERATURE,
  THETA_SPREAD,
  THETA_DESCENT,
  CROSS_BRANCH_MARGIN,
  TOP_K_LLM_CANDIDATES,
} from "./embedding/sorter.js";
export type { EmbeddingSortResult, DecisionSource, CrossBranchSignal } from "./embedding/sorter.js";
export { buildRoutingTelemetry, TELEMETRY_TOP_K } from "./embedding/telemetry.js";
// ─── Automated-mail detection ───────────────────────────────────────────────────
export {
  isAutomatedMessage,
  detectAutomatedThread,
  detectAutomatedThreadFromMeta,
} from "./detection/automated-mail.js";
// ─── Triage ───────────────────────────────────────────────────────────────────
export { analyzeThreadTriage } from "./triage/analyze.js";
export type { TriageMetadata } from "./triage/analyze.js";
export { classifyTriageByEmbedding, deriveNextStep } from "./triage/embed-triage.js";
export type { EmbeddingTriageResult } from "./triage/embed-triage.js";
// ─── Draft generation ─────────────────────────────────────────────────────────
export { generateDraft } from "./draft/generate.js";
export type { DraftContext, DraftResult } from "./draft/generate.js";
// ─── Taxonomy generation (from inbox) ───────────────────────────────────────────
export { buildTaxonomyGenerationMessages, buildRepairMessage } from "./taxonomy-gen/prompt.js";
export { generateTaxonomyFromProfile } from "./taxonomy-gen/generate.js";
export type { GenerateTaxonomyInput, GenerateTaxonomyResult } from "./taxonomy-gen/generate.js";
