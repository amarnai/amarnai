import type { TaxonomyTransferFile, GenerationEligibilityReason } from "@amarnai/shared";

// Shared display helpers for the "Generate from inbox" UI, used by both web and
// mobile so the copy and preview rendering stay identical across platforms.

/**
 * Translate a plain English source string (with optional ICU placeholder
 * values) against the active catalog. Callers pass `(s, v) => translateSource(i18n, s, v)`
 * so this module stays free of any i18n library, mirroring localizeTemplate.
 */
export type GenerationTranslate = (
  source: string,
  values?: Record<string, unknown>,
) => string;

const identityTranslate: GenerationTranslate = (source) => source;

/**
 * User-facing copy for each not-eligible reason. English is the source of truth;
 * pass `translate` to render in the user's locale. The English source strings
 * here are mirrored as `msg` declarations in
 * packages/ui/src/i18n/generation-reason-messages.ts so they land in the catalog.
 */
export function generationReasonText(
  reason: GenerationEligibilityReason,
  translate: GenerationTranslate = identityTranslate,
  nextEligibleAt?: string | null,
): string {
  const when = nextEligibleAt ? new Date(nextEligibleAt).toLocaleString() : null;
  switch (reason) {
    case "INBOX_TOO_SMALL":
      return translate(
        "Your inbox doesn't have enough variety yet to personalize a taxonomy. Choose a template instead.",
      );
    case "IMPORTING":
      return translate("Still importing your inbox. Check back once the import finishes.");
    case "NO_NEW_MAIL":
      return translate(
        "No significant new mail since your last generation, so the result would be the same. Available again once your inbox grows.",
      );
    case "COOLDOWN":
      return when
        ? translate("Recently attempted. Available again {when}.", { when })
        : translate("Recently attempted. Try again later.");
    case "MONTHLY_CAP":
      return when
        ? translate("You've used your generations for now. Available again {when}.", { when })
        : translate("You've used your generations for now.");
    default:
      return translate("Generation isn't available right now.");
  }
}

export interface GenerationPreviewRow {
  name: string;
  breadcrumb: string;
  description: string;
}

/** Ordered, breadcrumbed list of the proposed folders for preview. */
export function generationPreviewRows(file: TaxonomyTransferFile): GenerationPreviewRow[] {
  const byRef = new Map(file.nodes.map((n) => [n.ref, n]));
  const parent = new Map<string, string>();
  for (const e of file.edges) parent.set(e.targetRef, e.sourceRef);

  const breadcrumb = (ref: string): string => {
    const chain: string[] = [];
    let cur: string | undefined = ref;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const node = byRef.get(cur);
      if (!node) break;
      chain.unshift(node.name);
      cur = parent.get(cur);
    }
    // Drop the node's own name; keep only the ancestor path.
    return chain.slice(0, -1).join(" → ");
  };

  return file.nodes
    .filter((n) => !n.isRoot)
    .map((n) => ({
      name: n.name,
      breadcrumb: breadcrumb(n.ref),
      description: n.description ?? "",
    }));
}
