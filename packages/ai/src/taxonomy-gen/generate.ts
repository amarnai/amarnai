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

/** Generic fallback names a designated catch-all might already carry. */
const GENERIC_CATCH_ALL_NAME_RE = /\b(other|others|updates?|misc|miscellaneous|general)\b/i;

function isLeafRef(file: TaxonomyTransferFile, ref: string): boolean {
  return !file.edges.some((e) => e.sourceRef === ref);
}

/**
 * Guarantee exactly one catch-all leaf without discarding the model's work.
 * The mandatory catch-all is a single boolean the LLM sometimes drops or
 * duplicates; rather than fail validation (and fall back to the generic seed)
 * over it, deterministically designate one before validating:
 *  - zero  → mark a single non-root leaf (prefer the seed's catch-all ref, then
 *            a generically-named leaf, then the last leaf);
 *  - many  → keep the first valid catch-all leaf, clear the rest.
 * If the tree has no non-root leaf at all, leave it unchanged and let the
 * validator reject it (the repair pass / seed fallback then handles it).
 */
function normalizeCatchAll(file: TaxonomyTransferFile, seedCatchAllRef: string | null): TaxonomyTransferFile {
  const nonRootLeaves = file.nodes.filter((n) => !n.isRoot && isLeafRef(file, n.ref));
  const catchAlls = file.nodes.filter((n) => n.isCatchAll);

  const soleCatchAll = catchAlls.length === 1 ? catchAlls[0]! : null;
  if (soleCatchAll && !soleCatchAll.isRoot && isLeafRef(file, soleCatchAll.ref)) {
    return file; // already exactly one valid catch-all leaf
  }

  const designated =
    (seedCatchAllRef ? nonRootLeaves.find((n) => n.ref === seedCatchAllRef) : undefined) ??
    catchAlls.find((n) => !n.isRoot && isLeafRef(file, n.ref)) ??
    nonRootLeaves.find((n) => GENERIC_CATCH_ALL_NAME_RE.test(n.name)) ??
    nonRootLeaves[nonRootLeaves.length - 1];

  if (!designated) return file; // nothing to designate — validator will reject

  return {
    ...file,
    nodes: file.nodes.map((n) => ({ ...n, isCatchAll: n.ref === designated.ref })),
  };
}

/** Parse → coerce envelope fields → schema → normalize catch-all → deep validation. */
function coerceAndValidate(raw: string, now: Date, seedCatchAllRef: string | null): CoerceResult {
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
  const normalized = normalizeCatchAll(shape.data, seedCatchAllRef);
  const deep = validateTaxonomyTransfer(normalized);
  if (!deep.ok) return { ok: false, error: deep.error };
  return { ok: true, data: deep.data };
}

export async function generateTaxonomyFromProfile(
  input: GenerateTaxonomyInput,
): Promise<GenerateTaxonomyResult> {
  const { profile, seed, matchedTemplateName, targetLanguage, provider, now } = input;
  const fallbackSeed = input.fallbackSeed ?? seed;
  // The seed's catch-all ref is the preferred node to (re)designate when the
  // model drops or duplicates the catch-all flag.
  const seedCatchAllRef = seed.nodes.find((n) => n.isCatchAll)?.ref ?? null;
  const messages = buildTaxonomyGenerationMessages(
    profile,
    seed,
    matchedTemplateName,
    targetLanguage,
  );

  let raw = await provider.chat(messages);
  let result = coerceAndValidate(raw, now, seedCatchAllRef);

  if (!result.ok) {
    // One repair pass: feed the model its own output + the validation error.
    const repairMessages = [
      ...messages,
      { role: "assistant" as const, content: raw },
      buildRepairMessage(result.error, targetLanguage),
    ];
    raw = await provider.chat(repairMessages);
    result = coerceAndValidate(raw, now, seedCatchAllRef);
  }

  if (result.ok) return { file: result.data, usedFallback: false };

  // Guaranteed fallback: the (localized) seed template is always valid.
  return {
    file: { ...fallbackSeed, amarnaiTaxonomyVersion: 1, exportedAt: now.toISOString() },
    usedFallback: true,
  };
}
