import {
  TaxonomyTransferFileSchema,
  validateTaxonomyTransfer,
  type InboxProfile,
  type TaxonomyTransferFile,
} from "@amarnai/shared";
import type { AIProvider } from "../types.js";
import { buildTaxonomyGenerationMessages, buildRepairMessage } from "./prompt.js";

// Personalizes a seed template into an inbox-fitted taxonomy using the LLM.
// LLM output is untrusted: it is schema-parsed and structurally validated, with
// one repair pass, and a guaranteed fallback to the (always-valid) seed.

export interface GenerateTaxonomyInput {
  profile: InboxProfile;
  /** The matched template's transfer file — the seed AND the fallback. */
  seed: TaxonomyTransferFile;
  matchedTemplateName: string;
  provider: AIProvider;
  /** Stable timestamp stamped into the file (we never trust the model's). */
  now: Date;
}

export interface GenerateTaxonomyResult {
  file: TaxonomyTransferFile;
  /** True when both the initial and repair attempts failed and we used the seed. */
  usedFallback: boolean;
}

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) return JSON.parse(fenced[1]);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("No JSON object found in response");
}

type CoerceResult =
  | { ok: true; data: TaxonomyTransferFile }
  | { ok: false; error: string };

/** Parse → coerce envelope fields → schema → deep structural validation. */
function coerceAndValidate(raw: string, now: Date): CoerceResult {
  let parsed: unknown;
  try {
    parsed = extractJSON(raw);
  } catch (e) {
    return { ok: false, error: `output was not valid JSON: ${String(e)}` };
  }
  // Force the envelope fields so a missing/invalid version or timestamp from the
  // model never causes a spurious rejection.
  if (parsed && typeof parsed === "object") {
    (parsed as Record<string, unknown>).amarnaiTaxonomyVersion = 1;
    (parsed as Record<string, unknown>).exportedAt = now.toISOString();
  }
  const shape = TaxonomyTransferFileSchema.safeParse(parsed);
  if (!shape.success) {
    const detail = shape.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `shape invalid (${detail})` };
  }
  const deep = validateTaxonomyTransfer(shape.data);
  if (!deep.ok) return { ok: false, error: deep.error };
  return { ok: true, data: deep.data };
}

export async function generateTaxonomyFromProfile(
  input: GenerateTaxonomyInput,
): Promise<GenerateTaxonomyResult> {
  const { profile, seed, matchedTemplateName, provider, now } = input;
  const messages = buildTaxonomyGenerationMessages(profile, seed, matchedTemplateName);

  let raw = await provider.chat(messages);
  let result = coerceAndValidate(raw, now);

  if (!result.ok) {
    // One repair pass: feed the model its own output + the validation error.
    const repairMessages = [
      ...messages,
      { role: "assistant" as const, content: raw },
      buildRepairMessage(result.error),
    ];
    raw = await provider.chat(repairMessages);
    result = coerceAndValidate(raw, now);
  }

  if (result.ok) return { file: result.data, usedFallback: false };

  // Guaranteed fallback: the seed template is always valid.
  return {
    file: { ...seed, amarnaiTaxonomyVersion: 1, exportedAt: now.toISOString() },
    usedFallback: true,
  };
}
