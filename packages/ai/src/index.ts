export type { AIProvider, AIProviderConfig, ClassifyInput, ClassifyOutput, TaxonomyNodeInput, TaxonomyEdgeInput, ThreadMessage } from "./types.js";
export { LLMOutputSchema } from "./types.js";
export { createAIProvider } from "./create-provider.js";
export { classifyThread } from "./classify.js";
export { parseAndValidateOutput } from "./validator.js";
export { buildClassificationPrompt } from "./prompt.js";
export { selectCandidatePaths, tokenize, MAX_CANDIDATE_PATHS } from "./candidate-selector.js";
export type { EmailInput, CandidatePath, CandidateEdgeStep, CandidatePathResult } from "./candidate-selector.js";
export { buildCandidatePathPrompt } from "./candidate-path-prompt.js";
export type { PathSelectionContext } from "./candidate-path-prompt.js";
export { validatePathSelection, MIN_LLM_PATH_CONFIDENCE } from "./candidate-path-validator.js";
export type { PathSelectionResult } from "./candidate-path-validator.js";
export { selectPathFromCandidates } from "./select-path.js";
export type { ThreadSnapshot, SnapshotMessage, AttachmentMeta } from "./thread-snapshot.js";
export { snapshotToThreadMessages } from "./thread-snapshot.js";
// ─── Embedding ────────────────────────────────────────────────────────────────
export type { EmbeddingProvider, EmbeddingProviderConfig, EmbeddableNode, UpdatedNodeEmbedding } from "./embedding-types.js";
export { createEmbeddingProvider } from "./create-embedding-provider.js";
export {
  cosineSimilarity,
  softmax,
  buildNodeEmbeddingText,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
  computeSubtreeScores,
} from "./embedding-math.js";
export {
  sortThreadByEmbedding,
  THETA_MIN,
  LAMBDA_DEPTH_DECAY,
  SOFTMAX_TEMPERATURE,
  THETA_SPREAD,
  DELTA_DESCENT_MARGIN,
  CROSS_BRANCH_MARGIN,
  TOP_K_LLM_CANDIDATES,
} from "./embedding-sorter.js";
export type { EmbeddingSortResult, DecisionSource } from "./embedding-sorter.js";
