import { z } from "zod";

// ─── Reusable field validators ─────────────────────────────────────────────────

const HTML_TAG_RE = /<[a-zA-Z][^>]*>/;

const CJK_CHAR_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/**
 * True when most of a string's non-whitespace characters are CJK
 * (Chinese/Japanese/Korean). Length floors meant for space-delimited Latin
 * scripts are too high for these scripts — natural folder names are often two
 * ideographs and a single sentence carries far more meaning per character — so
 * the name/description minimums are relaxed when this is true.
 */
export function isPredominantlyCJK(value: string): boolean {
  const nonSpace = value.replace(/\s/g, "");
  if (nonSpace.length === 0) return false;
  const cjk = nonSpace.match(CJK_CHAR_RE)?.length ?? 0;
  return cjk / nonSpace.length > 0.5;
}

/** Minimum trimmed character count for a folder name, by script. */
export function minNodeNameLength(value: string): number {
  return isPredominantlyCJK(value) ? 2 : 3;
}

/** Minimum non-whitespace character count for a description, by script. */
export function minNodeDescriptionLength(value: string): number {
  return isPredominantlyCJK(value) ? 12 : 30;
}

export const nodeNameSchema = z
  .string()
  .trim()
  .max(40, "Name must be at most 40 characters")
  .refine(
    (v) => v.length >= minNodeNameLength(v),
    "Name must be at least 3 characters (2 for Chinese/Japanese)"
  )
  .refine(
    (v) => /[\p{L}\p{N}]/u.test(v),
    "Name must contain at least one letter or digit"
  );

// Required for all non-root nodes. Provides semantic context for AI candidate
// path selection via description embeddings.
export const nodeDescriptionSchema = z
  .string()
  .trim()
  .max(300, "Description must be at most 300 characters")
  .refine(
    (v) => v.replace(/\s/g, "").length >= minNodeDescriptionLength(v),
    "Description must have at least 30 non-whitespace characters (12 for Chinese/Japanese). Descriptions improve AI sorting quality."
  )
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
  draftPrompt: z.string().max(500).nullable(),
  examples: z.array(z.string()),
  isRoot: z.boolean(),
  /** Non-routable catch-all destination ("Updates / Other"). Optional for back-compat. */
  isCatchAll: z.boolean().optional(),
  /** Optional per-folder color override (a palette key). null/absent = default. */
  colorKey: z.string().nullable().optional(),
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
    draftPrompt: z.string().trim().max(500).nullable().optional(),
    examples: z.array(z.string()).optional(),
    colorKey: z.string().trim().max(32).nullable().optional(),
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
    draftPrompt: z.string().trim().max(500).nullable().optional(),
    examples: z.array(z.string()).optional(),
    colorKey: z.string().trim().max(32).nullable().optional(),
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxonomyEdge = z.infer<typeof TaxonomyEdgeSchema>;

export const CreateTaxonomyEdgeInputSchema = z.object({
  workspaceId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
});
export type CreateTaxonomyEdgeInput = z.infer<typeof CreateTaxonomyEdgeInputSchema>;

// ─── ClassificationPathStep ───────────────────────────────────────────────────

export const ClassificationPathStepSchema = z.object({
  edgeId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
});
export type ClassificationPathStep = z.infer<typeof ClassificationPathStepSchema>;
