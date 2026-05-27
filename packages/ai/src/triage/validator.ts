/**
 * Validates the LLM triage metadata response.
 *
 * Returns a typed `TriageMetadata` object on success, or `null` if the LLM
 * output is unparseable or fails schema validation. Callers treat null as
 * "metadata unavailable" — a triage failure must not break the classification
 * pipeline.
 *
 * All enum fields fall back to safe defaults rather than crashing:
 *   priority        → MEDIUM
 *   urgency         → UNKNOWN
 *   riskLevel       → LOW
 *   requiredAction  → UNKNOWN
 *   sensitivity     → NORMAL
 *   dueAt           → null
 *   suggestedNextStep → ASK_USER
 */
import { z } from "zod";
import {
  PrioritySchema,
  UrgencySchema,
  RiskLevelSchema,
  RequiredActionSchema,
  SensitivitySchema,
  SuggestedNextStepSchema,
} from "@amarnai/shared";

export type TriageMetadata = {
  priority: z.infer<typeof PrioritySchema>;
  urgency: z.infer<typeof UrgencySchema>;
  riskLevel: z.infer<typeof RiskLevelSchema>;
  requiredAction: z.infer<typeof RequiredActionSchema>;
  sensitivity: z.infer<typeof SensitivitySchema>;
  dueAt: string | null;   // ISO 8601 UTC, or null
  suggestedNextStep: z.infer<typeof SuggestedNextStepSchema>;
};

/**
 * Normalise whatever the LLM returns for dueAt into an ISO 8601 UTC string,
 * or null.  LLMs commonly return date-only strings ("2026-06-01"), datetimes
 * without timezone ("2026-06-01T09:00:00"), or the string literal "null"
 * instead of a JSON null.  Strict datetime validation would fail all of these
 * and silently drop all seven triage fields — so we accept any string and
 * normalise rather than reject.
 */
function normaliseDueAt(val: string | null | undefined): string | null {
  if (val == null || val === "null" || val.trim() === "") return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const LLMTriageSchema = z.object({
  priority: PrioritySchema,
  urgency: UrgencySchema,
  riskLevel: RiskLevelSchema,
  requiredAction: RequiredActionSchema,
  sensitivity: SensitivitySchema,
  // Accept any string (or null/omitted) and normalise in normaliseDueAt.
  dueAt: z.union([z.string(), z.null()]).optional(),
  suggestedNextStep: SuggestedNextStepSchema,
});

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("No JSON object found in response");
}

export function validateTriageMetadata(rawText: string): TriageMetadata | null {
  let parsed: unknown;
  try {
    parsed = extractJSON(rawText);
  } catch (e) {
    console.warn(`[triage-validator] Failed to parse LLM output as JSON: ${String(e)}`);
    return null;
  }

  const result = LLMTriageSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      `[triage-validator] LLM triage schema validation failed: ${result.error.message}`
    );
    return null;
  }

  const d = result.data;
  return {
    priority: d.priority,
    urgency: d.urgency,
    riskLevel: d.riskLevel,
    requiredAction: d.requiredAction,
    sensitivity: d.sensitivity,
    dueAt: normaliseDueAt(d.dueAt),
    suggestedNextStep: d.suggestedNextStep,
  };
}
