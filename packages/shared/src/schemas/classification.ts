import { z } from "zod";
import {
  PrioritySchema,
  RiskLevelSchema,
  RequiredActionSchema,
  SensitivitySchema,
  SuggestedNextStepSchema,
  UrgencySchema,
} from "./email-metadata.js";
import { ClassificationPathStepSchema } from "./taxonomy.js";

/**
 * Compact, storage-bounded summary of an embedding routing decision, persisted
 * to EmailClassification.rawOutput. Holds only the maxima and the top-K node
 * similarities (not the full per-node maps) so the row stays small at hosted
 * scale while preserving enough signal to diagnose a single routing decision
 * and to tune sub-threshold behaviour (e.g. a future rescue floor) on real data.
 *
 * PRIVACY INVARIANT: this payload must contain ONLY derived scalars (scores,
 * thresholds) and the workspace's own taxonomy node IDs. Never add email-derived
 * data here — no subject/body text, sender, or the thread embedding vector.
 * Embeddings are invertible and count as email content; persisting one would
 * violate "store minimal email data". Keep this map small and content-free.
 */
export const RoutingTelemetrySchema = z.object({
  /** Payload version, so readers can evolve the shape safely. */
  v: z.literal(1),
  /** Highest raw cosine similarity across all non-root nodes. */
  maxRawSim: z.number(),
  /** Highest bottom-up subtree score; the value the quality gate tests. */
  maxSubtreeScore: z.number(),
  /** Quality-gate threshold (THETA_MIN or override) in effect for this run. */
  thetaMin: z.number(),
  /** Top nodes by raw cosine similarity, highest first. */
  topRawSims: z.array(z.object({ nodeId: z.string(), sim: z.number() })),
});
export type RoutingTelemetry = z.infer<typeof RoutingTelemetrySchema>;

export const ClassificationResultSchema = z.object({
  finalNodeId: z.string().min(1),
  path: z.array(ClassificationPathStepSchema),
  confidence: z.number().min(0).max(1),
  explanation: z.string().optional(),
  priority: PrioritySchema,
  urgency: UrgencySchema,
  riskLevel: RiskLevelSchema,
  requiredAction: RequiredActionSchema,
  sensitivity: SensitivitySchema,
  dueAt: z.string().datetime().optional(),
  suggestedNextStep: SuggestedNextStepSchema,
  needsHumanReview: z.boolean(),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  promptVersion: z.string().optional(),
  rawOutput: z.record(z.unknown()).optional(),
});
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
