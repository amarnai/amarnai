import { z } from "zod";

export const TaxonomyNodeKindSchema = z.enum(["CATEGORY", "RULE"]);
export type TaxonomyNodeKind = z.infer<typeof TaxonomyNodeKindSchema>;

export const DraftBehaviorSchema = z.enum([
  "DISABLED",
  "MANUAL_REVIEW",
  "CREATE_GMAIL_DRAFT",
]);
export type DraftBehavior = z.infer<typeof DraftBehaviorSchema>;

export const CreateTaxonomyNodeInputSchema = z.object({
  workspaceId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  kind: TaxonomyNodeKindSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  instructions: z.string().max(2000).optional(),
  examples: z.array(z.string()).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  allowedActions: z.array(z.string()).optional(),
  draftBehavior: DraftBehaviorSchema.optional(),
  syncToGmail: z.boolean().optional(),
  gmailLabelId: z.string().optional(),
  gmailLabelName: z.string().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});
export type CreateTaxonomyNodeInput = z.infer<typeof CreateTaxonomyNodeInputSchema>;

export const UpdateTaxonomyNodeInputSchema = CreateTaxonomyNodeInputSchema.omit({
  workspaceId: true,
}).partial();
export type UpdateTaxonomyNodeInput = z.infer<typeof UpdateTaxonomyNodeInputSchema>;
