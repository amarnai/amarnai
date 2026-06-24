import type { TaxonomyTransferFile, GenerationEligibilityReason } from "@amarnai/shared";

// Shared display helpers for the "Generate from inbox" UI, used by both web and
// mobile so the copy and preview rendering stay identical across platforms.

/** User-facing copy for each not-eligible reason. */
export function generationReasonText(
  reason: GenerationEligibilityReason,
  nextEligibleAt?: string | null,
): string {
  const when = nextEligibleAt ? new Date(nextEligibleAt).toLocaleString() : null;
  switch (reason) {
    case "INBOX_TOO_SMALL":
      return "Your inbox doesn't have enough variety yet to personalize a taxonomy. Choose a template instead.";
    case "IMPORTING":
      return "Still importing your inbox. Check back once the import finishes.";
    case "NO_NEW_MAIL":
      return "No significant new mail since your last generation, so the result would be the same. Available again once your inbox grows.";
    case "COOLDOWN":
      return when ? `Recently attempted. Available again ${when}.` : "Recently attempted. Try again later.";
    case "MONTHLY_CAP":
      return when
        ? `You've used your generations for now. Available again ${when}.`
        : "You've used your generations for now.";
    default:
      return "Generation isn't available right now.";
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
