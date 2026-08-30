/**
 * Embedding-based triage classifier for MVP.
 *
 * Classifies `sensitivity` and `requiredAction` by comparing the thread
 * embedding vector against per-class exemplar texts using cosine similarity.
 * `suggestedNextStep` is derived deterministically from `requiredAction`.
 *
 * LLM-dependent fields (`priority`, `urgency`, `riskLevel`, `dueAt`) are
 * not produced here — they are deferred post-MVP to paid-tier LLM triage.
 *
 * Exemplar embeddings are cached in a module-level Map keyed by
 * `"${modelName}::${text}"` to avoid re-embedding static strings on every
 * classification call within the same worker process.
 */
import { cosineSimilarity } from "../embedding/math.js";
import type { EmbeddingProvider } from "../embedding/types.js";
import type {
  Sensitivity,
  RequiredAction,
  SuggestedNextStep,
} from "@aziru/shared";

export type EmbeddingTriageResult = {
  sensitivity: Sensitivity;
  requiredAction: RequiredAction;
  suggestedNextStep: SuggestedNextStep;
};

// ─── Exemplar texts ───────────────────────────────────────────────────────────
//
// One short sentence per class, written to be semantically distinct.
// Order matches the enum values and is used as the index in classified arrays.

export const SENSITIVITY_EXEMPLARS: Record<Sensitivity, string> = {
  NORMAL: "This is a regular business email with no sensitive content.",
  CONFIDENTIAL: "This email contains confidential business information that should not be shared.",
  PERSONAL_DATA: "This email contains personal information such as names, addresses, or identification numbers.",
  FINANCIAL: "This email contains financial details such as invoices, bank accounts, or payment information.",
  LEGAL: "This email contains legal documents, contracts, NDAs, or regulatory notices.",
  SECURITY: "This email contains security credentials, access tokens, authentication codes, or security alerts.",
};

export const REQUIRED_ACTION_EXEMPLARS: Record<RequiredAction, string> = {
  NONE: "This email is informational only and requires no action.",
  REPLY: "A written response is expected to this email.",
  REVIEW: "A document, proposal, or file attached to this email needs to be reviewed.",
  APPROVE: "This email requests explicit approval or sign-off.",
  SCHEDULE: "This email asks to arrange a meeting, call, or appointment.",
  PAY: "This email contains an invoice or requests a payment or financial transaction.",
  DELEGATE: "This email should be forwarded or assigned to someone else.",
  ARCHIVE: "This email is informational and should be saved and closed.",
  UNKNOWN: "The required action for this email is unclear.",
};

// ─── Exemplar embedding cache ─────────────────────────────────────────────────
//
// Keyed by `"${modelName}::${text}"`. Populated lazily on first use per model.

const exemplarCache = new Map<string, number[]>();

async function getExemplarVectors(
  exemplars: Record<string, string>,
  provider: EmbeddingProvider
): Promise<Map<string, number[]>> {
  const keys = Object.keys(exemplars) as string[];
  const texts = Object.values(exemplars) as string[];

  const uncachedTexts: string[] = [];
  const uncachedKeys: string[] = [];

  for (let i = 0; i < keys.length; i++) {
    const cacheKey = `${provider.modelName}::${texts[i]}`;
    if (!exemplarCache.has(cacheKey)) {
      uncachedTexts.push(texts[i]!);
      uncachedKeys.push(keys[i]!);
    }
  }

  if (uncachedTexts.length > 0) {
    const vectors = await provider.embed(uncachedTexts);
    for (let i = 0; i < uncachedKeys.length; i++) {
      const cacheKey = `${provider.modelName}::${uncachedTexts[i]}`;
      exemplarCache.set(cacheKey, vectors[i]!);
    }
  }

  const result = new Map<string, number[]>();
  for (let i = 0; i < keys.length; i++) {
    const cacheKey = `${provider.modelName}::${texts[i]}`;
    result.set(keys[i]!, exemplarCache.get(cacheKey)!);
  }
  return result;
}

// ─── Classification helpers ───────────────────────────────────────────────────

const MIN_SIMILARITY = 0.15;

function classifyByEmbedding<T extends string>(
  threadVector: number[],
  exemplarVectors: Map<string, number[]>,
  fallback: T
): T {
  let bestKey: string | null = null;
  let bestScore = -Infinity;

  for (const [key, vector] of exemplarVectors) {
    const score = cosineSimilarity(threadVector, vector);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestKey === null || bestScore < MIN_SIMILARITY) return fallback;
  return bestKey as T;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function deriveNextStep(requiredAction: RequiredAction): SuggestedNextStep {
  switch (requiredAction) {
    case "ARCHIVE":
    case "NONE":
      return "LABEL_ONLY";
    case "REPLY":
    case "SCHEDULE":
      return "CREATE_DRAFT";
    case "PAY":
    case "APPROVE":
      return "OPEN_IN_GMAIL";
    case "REVIEW":
    case "DELEGATE":
    case "UNKNOWN":
      return "ASK_USER";
  }
}

export async function classifyTriageByEmbedding(
  threadVector: number[],
  embeddingProvider: EmbeddingProvider
): Promise<EmbeddingTriageResult> {
  const [sensitivityVectors, requiredActionVectors] = await Promise.all([
    getExemplarVectors(SENSITIVITY_EXEMPLARS, embeddingProvider),
    getExemplarVectors(REQUIRED_ACTION_EXEMPLARS, embeddingProvider),
  ]);

  const sensitivity = classifyByEmbedding<Sensitivity>(
    threadVector,
    sensitivityVectors,
    "NORMAL"
  );

  const requiredAction = classifyByEmbedding<RequiredAction>(
    threadVector,
    requiredActionVectors,
    "UNKNOWN"
  );

  const suggestedNextStep = deriveNextStep(requiredAction);

  return { sensitivity, requiredAction, suggestedNextStep };
}
