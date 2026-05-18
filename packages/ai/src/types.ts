import { z } from "zod";
import {
  PrioritySchema,
  UrgencySchema,
  RiskLevelSchema,
  RequiredActionSchema,
  SensitivitySchema,
  SuggestedNextStepSchema,
} from "@genizor/shared";

// ─── Input types ───────────────────────────────────────────────────────────────

export type ThreadMessage = {
  subject: string | null;
  senderEmail: string;
  senderName: string | null;
  bodyText: string | null;
  receivedAt: Date | string;
};

export type TaxonomyNodeInput = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  examples: string[];
  isRoot: boolean;
  isVisibleCategory: boolean;
  canReceiveEmails: boolean;
};

export type TaxonomyEdgeInput = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sortingQuestion: string;
  examples: string[];
  negativeExamples: string[];
};

export type ClassifyInput = {
  nodes: TaxonomyNodeInput[];
  edges: TaxonomyEdgeInput[];
  messages: ThreadMessage[];
};

// ─── LLM output schema (finalNodeId is nullable) ───────────────────────────────

export const LLMOutputSchema = z.object({
  finalNodeId: z.string().min(1).nullable(),
  path: z.array(
    z.object({
      nodeId: z.string().min(1),
      nodeName: z.string().min(1),
    })
  ),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  priority: PrioritySchema,
  urgency: UrgencySchema,
  riskLevel: RiskLevelSchema,
  requiredAction: RequiredActionSchema,
  sensitivity: SensitivitySchema,
  dueAt: z.string().datetime().nullable().optional(),
  suggestedNextStep: SuggestedNextStepSchema,
  needsHumanReview: z.boolean(),
});

export type LLMOutput = z.infer<typeof LLMOutputSchema>;

export type ClassifyOutput = {
  finalNodeId: string | null;
  path: Array<{ nodeId: string; nodeName: string }>;
  confidence: number;
  explanation: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  urgency: "NONE" | "SOON" | "TODAY" | "OVERDUE" | "UNKNOWN";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  requiredAction: "NONE" | "REPLY" | "REVIEW" | "APPROVE" | "SCHEDULE" | "PAY" | "DELEGATE" | "ARCHIVE" | "UNKNOWN";
  sensitivity: "NORMAL" | "CONFIDENTIAL" | "PERSONAL_DATA" | "FINANCIAL" | "LEGAL" | "SECURITY";
  dueAt: string | null;
  suggestedNextStep: "LABEL_ONLY" | "CREATE_DRAFT" | "ASK_USER" | "OPEN_IN_GMAIL";
  needsHumanReview: boolean;
};

// ─── Provider interface ────────────────────────────────────────────────────────

export interface AIProvider {
  readonly providerName: string;
  readonly modelName: string;
  chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string>;
}

// ─── Provider config ───────────────────────────────────────────────────────────

export type AIProviderConfig = {
  provider: "mock" | "ollama" | "frontier";
  ollama?: {
    baseUrl?: string;
    model?: string;
  };
  frontier?: {
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
};
