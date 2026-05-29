import { z } from "zod";

export type DraftResult = {
  subject: string;
  body: string;
};

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

const LLMDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export function validateDraftResult(rawText: string): DraftResult | null {
  const preview = rawText.slice(0, 500);

  let parsed: unknown;
  try {
    parsed = extractJSON(rawText);
  } catch (e) {
    console.error(
      `[draft-validator] Failed to parse LLM output as JSON: ${String(e)}\nRaw (first 500 chars): ${preview}`
    );
    return null;
  }

  const result = LLMDraftSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `[draft-validator] LLM draft schema validation failed: ${result.error.message}\nParsed value: ${JSON.stringify(parsed)}\nRaw (first 500 chars): ${preview}`
    );
    return null;
  }

  return { subject: result.data.subject, body: result.data.body };
}
