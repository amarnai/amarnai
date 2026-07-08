import type { InboxProfile } from "@amarnai/shared";
import { TAXONOMY_TEMPLATES, type TaxonomyTemplate } from "./templates.js";

// Deterministic template matcher for taxonomy generation. Given an InboxProfile,
// score each built-in template by token overlap between the template's folder
// names/descriptions and the inbox's frequency-ranked signal, and return the
// best-fitting template. The result is the LLM seed AND the guaranteed fallback
// when generation fails validation.

/** Common words that carry no category signal. */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "your", "you", "are", "our", "this",
  "that", "all", "any", "com", "net", "org", "www", "mail", "email", "inbox",
  "re", "fwd", "to", "of", "in", "on", "at", "by", "or", "a", "an", "is", "it",
]);

/** Lowercase, split on non-alphanumerics, drop stop words and very short tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/** Relative weight of each profile signal toward template matching. */
const SIGNAL_WEIGHT = {
  subjectKeywords: 3,
  gmailLabels: 3,
  senderNames: 2,
  senderDomains: 1,
} as const;

/** Build the token bag for a template from its non-root folder names + descriptions. */
function templateTokens(template: TaxonomyTemplate): Set<string> {
  const tokens = new Set<string>();
  for (const node of template.file.nodes) {
    if (node.isRoot) continue;
    for (const t of tokenize(node.name)) tokens.add(t);
    if (node.description) for (const t of tokenize(node.description)) tokens.add(t);
  }
  return tokens;
}

/** Score one template against a weighted bag of profile tokens. */
function scoreTemplate(template: TaxonomyTemplate, weighted: Map<string, number>): number {
  const tokens = templateTokens(template);
  let score = 0;
  for (const [token, weight] of weighted) {
    if (tokens.has(token)) score += weight;
  }
  return score;
}

/** Accumulate weighted tokens from the profile's frequency-ranked signals. */
function weightProfileTokens(profile: InboxProfile): Map<string, number> {
  const weighted = new Map<string, number>();
  const add = (term: string, count: number, signalWeight: number) => {
    for (const token of tokenize(term)) {
      weighted.set(token, (weighted.get(token) ?? 0) + count * signalWeight);
    }
  };
  for (const t of profile.subjectKeywords) add(t.term, t.count, SIGNAL_WEIGHT.subjectKeywords);
  for (const t of profile.gmailLabels) add(t.term, t.count, SIGNAL_WEIGHT.gmailLabels);
  for (const t of profile.senderNames) add(t.term, t.count, SIGNAL_WEIGHT.senderNames);
  for (const t of profile.senderDomains) add(t.term, t.count, SIGNAL_WEIGHT.senderDomains);
  return weighted;
}

/** The zero-signal default: the least prescriptive template for an unknown inbox. */
const FALLBACK_TEMPLATE_ID = "personal";

/**
 * Return the best-fitting built-in template for an inbox profile. Ties resolve
 * deterministically to the first template in TAXONOMY_TEMPLATES order. When no
 * template overlaps the profile at all (empty or unusable signal), falls back to
 * the "Personal / Family" template — a safe generic default that assumes nothing
 * about the user's profession, rather than whichever template is authored first.
 */
export function matchTemplateToProfile(profile: InboxProfile): TaxonomyTemplate {
  const weighted = weightProfileTokens(profile);
  let best: TaxonomyTemplate | null = null;
  let bestScore = 0;
  for (const template of TAXONOMY_TEMPLATES) {
    const score = scoreTemplate(template, weighted);
    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  }
  return (
    best ??
    TAXONOMY_TEMPLATES.find((t) => t.id === FALLBACK_TEMPLATE_ID) ??
    TAXONOMY_TEMPLATES[0]!
  );
}
