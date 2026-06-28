import {
  TaxonomyTransferFileSchema,
  validateTaxonomyTransfer,
  type InboxProfile,
  type TaxonomyTransferFile,
} from "@amarnai/shared";
import type { AIProvider } from "../types.js";
import { extractJSON } from "../json-util.js";
import { buildTaxonomyGenerationMessages, buildRepairMessage } from "./prompt.js";

// Personalizes a seed template into an inbox-fitted taxonomy using the LLM.
// LLM output is untrusted: it is schema-parsed and structurally validated, with
// one repair pass, and a guaranteed fallback to the (always-valid) seed.

export interface GenerateTaxonomyInput {
  profile: InboxProfile;
  /** The matched template's transfer file in English — the structural seed
   * shown to the model (which is told to write its output in targetLanguage). */
  seed: TaxonomyTransferFile;
  matchedTemplateName: string;
  /** English name of the language the model must write names/descriptions in. */
  targetLanguage: string;
  /** The guaranteed fallback used when the model output is unusable. Should be
   * the seed already localized to the target language; defaults to `seed`. */
  fallbackSeed?: TaxonomyTransferFile;
  provider: AIProvider;
  /** Stable timestamp stamped into the file (we never trust the model's). */
  now: Date;
}

export interface GenerateTaxonomyResult {
  file: TaxonomyTransferFile;
  /** True when both the initial and repair attempts failed and we used the seed. */
  usedFallback: boolean;
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
  const { profile, seed, matchedTemplateName, targetLanguage, provider, now } = input;
  const fallbackSeed = input.fallbackSeed ?? seed;
  const messages = buildTaxonomyGenerationMessages(
    profile,
    seed,
    matchedTemplateName,
    targetLanguage,
  );

  let raw = await provider.chat(messages);
  let result = coerceAndValidate(raw, now);

  if (!result.ok) {
    // One repair pass: feed the model its own output + the validation error.
    const repairMessages = [
      ...messages,
      { role: "assistant" as const, content: raw },
      buildRepairMessage(result.error, targetLanguage),
    ];
    raw = await provider.chat(repairMessages);
    result = coerceAndValidate(raw, now);
  }

  if (result.ok) return { file: result.data, usedFallback: false };

  // Guaranteed fallback: the (localized) seed template is always valid.
  return {
    file: { ...fallbackSeed, amarnaiTaxonomyVersion: 1, exportedAt: now.toISOString() },
    usedFallback: true,
  };
}
