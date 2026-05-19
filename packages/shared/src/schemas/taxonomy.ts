import { z } from "zod";

// ─── Reusable field validators ─────────────────────────────────────────────────

const HTML_TAG_RE = /<[a-zA-Z][^>]*>/;

// Exported so API routes and other packages can share the same field rules.
export const nodeNameSchema = z
  .string()
  .trim()
  .min(3, "Name must be at least 3 characters")
  .max(60, "Name must be at most 60 characters")
  .refine(
    (v) => /[\p{L}\p{N}]/u.test(v),
    "Name must contain at least one letter or digit"
  );

// Required for all non-root nodes. Provides semantic context for AI candidate
// path selection: future retrieval uses node name, description, ancestor path,
// edge question, and sibling context.
export const nodeDescriptionSchema = z
  .string()
  .trim()
  .min(
    20,
    "Description must be at least 20 characters. Descriptions improve AI sorting quality."
  )
  .max(300, "Description must be at most 300 characters")
  .refine(
    (v) => !HTML_TAG_RE.test(v),
    "Description must be plain text (no HTML). Descriptions improve AI sorting quality."
  );

// ─── TaxonomyNode ─────────────────────────────────────────────────────────────

// Read schema is intentionally lenient — existing DB rows may pre-date stricter
// input constraints and must not crash loading or classification.
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

// All nodes created via the API are non-root, so description is required here.
// Root Inbox is created by the seed and bypasses this schema.
export const CreateTaxonomyNodeInputSchema = z
  .object({
    workspaceId: z.string().min(1),
    name: nodeNameSchema,
    description: nodeDescriptionSchema,
    instructions: z.string().max(2000).optional(),
    examples: z.array(z.string()).optional(),
    isVisibleCategory: z.boolean().optional(),
    canReceiveEmails: z.boolean().optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.description.trim().toLowerCase() ===
      data.name.trim().toLowerCase()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Description must differ from the node name. Descriptions improve AI sorting quality.",
        path: ["description"],
      });
    }
  });
export type CreateTaxonomyNodeInput = z.infer<typeof CreateTaxonomyNodeInputSchema>;

// Defined independently (not derived from Create) because ZodEffects produced
// by superRefine does not support .omit().partial().
export const UpdateTaxonomyNodeInputSchema = z
  .object({
    name: nodeNameSchema.optional(),
    description: nodeDescriptionSchema.optional(),
    instructions: z.string().max(2000).optional(),
    examples: z.array(z.string()).optional(),
    isVisibleCategory: z.boolean().optional(),
    canReceiveEmails: z.boolean().optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.name !== undefined &&
      data.description !== undefined &&
      data.description.trim().toLowerCase() === data.name.trim().toLowerCase()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Description must differ from the node name. Descriptions improve AI sorting quality.",
        path: ["description"],
      });
    }
  });
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
