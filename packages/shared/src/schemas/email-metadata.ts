import { z } from "zod";

export const PrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const UrgencySchema = z.enum(["NONE", "SOON", "TODAY", "OVERDUE", "UNKNOWN"]);
export type Urgency = z.infer<typeof UrgencySchema>;

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const RequiredActionSchema = z.enum([
  "NONE",
  "REPLY",
  "REVIEW",
  "APPROVE",
  "SCHEDULE",
  "PAY",
  "DELEGATE",
  "ARCHIVE",
  "UNKNOWN",
]);
export type RequiredAction = z.infer<typeof RequiredActionSchema>;

export const SensitivitySchema = z.enum([
  "NORMAL",
  "CONFIDENTIAL",
  "PERSONAL_DATA",
  "FINANCIAL",
  "LEGAL",
  "SECURITY",
]);
export type Sensitivity = z.infer<typeof SensitivitySchema>;

export const SuggestedNextStepSchema = z.enum([
  "LABEL_ONLY",
  "CREATE_DRAFT",
  "ASK_USER",
  "OPEN_IN_GMAIL",
]);
export type SuggestedNextStep = z.infer<typeof SuggestedNextStepSchema>;
