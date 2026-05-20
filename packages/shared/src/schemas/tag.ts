import { z } from "zod";

export const TagSourceSchema = z.enum(["AMARNAI", "GMAIL"]);
export type TagSource = z.infer<typeof TagSourceSchema>;

export const CreateTagInputSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
    .optional(),
  source: TagSourceSchema,
  gmailLabelId: z.string().optional(),
});
export type CreateTagInput = z.infer<typeof CreateTagInputSchema>;
