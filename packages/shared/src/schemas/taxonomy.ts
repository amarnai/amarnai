import { z } from "zod";

// ─── TaxonomyNode ─────────────────────────────────────────────────────────────

export const TaxonomyNodeSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable(),
  instructions: z.string().max(2000).nullable(),
  examples: z.array(z.string()),
  isRoot: z.boolean(),
  isVisibleCategory: z.boolean(),
  canReceiveEmails: z.boolean(),
  positionX: z.number(),
  positionY: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxonomyNode = z.infer<typeof TaxonomyNodeSchema>;

export const CreateTaxonomyNodeInputSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  instructions: z.string().max(2000).optional(),
  examples: z.array(z.string()).optional(),
  isVisibleCategory: z.boolean().optional(),
  canReceiveEmails: z.boolean().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});
export type CreateTaxonomyNodeInput = z.infer<typeof CreateTaxonomyNodeInputSchema>;

export const UpdateTaxonomyNodeInputSchema = CreateTaxonomyNodeInputSchema.omit({
  workspaceId: true,
}).partial();
export type UpdateTaxonomyNodeInput = z.infer<typeof UpdateTaxonomyNodeInputSchema>;

// ─── TaxonomyEdge ─────────────────────────────────────────────────────────────

export const TaxonomyEdgeSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sortingQuestion: z.string().max(160),
  examples: z.array(z.string()),
  negativeExamples: z.array(z.string()),
  priority: z.number().int(),
  confidenceThreshold: z.number().min(0).max(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxonomyEdge = z.infer<typeof TaxonomyEdgeSchema>;

export const CreateTaxonomyEdgeInputSchema = z.object({
  workspaceId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sortingQuestion: z.string().max(160),
  examples: z.array(z.string()).optional(),
  negativeExamples: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
});
export type CreateTaxonomyEdgeInput = z.infer<typeof CreateTaxonomyEdgeInputSchema>;

// ─── ClassificationPathStep ───────────────────────────────────────────────────

export const ClassificationPathStepSchema = z.object({
  edgeId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sortingQuestion: z.string(),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
});
export type ClassificationPathStep = z.infer<typeof ClassificationPathStepSchema>;
