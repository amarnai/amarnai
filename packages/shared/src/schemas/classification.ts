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
