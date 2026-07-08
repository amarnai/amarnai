import { describe, it, expect } from "vitest";
import type { InboxProfile } from "@amarnai/shared";
import { matchTemplateToProfile } from "./matchTemplateToProfile.js";
import { TAXONOMY_TEMPLATES } from "./templates.js";

function profile(keywords: string[]): InboxProfile {
  return {
    eligibleThreadCount: 500,
    senderDomains: [],
    senderNames: [],
    subjectKeywords: keywords.map((term, i) => ({ term, count: 10 - i })),
    gmailLabels: [],
    senderClusters: [],
  };
}

// One profession-signature keyword set per template. Each keyword is a token
// that appears in exactly one template's folder names/descriptions, so the
// matcher must resolve each set to its owning template. Also doubles as the
// completeness guard: the key set must equal the template ids.
const SIGNATURE_PROFILES: Record<string, string[]> = {
  freelancer: ["clients", "invoices", "deliverables", "freelance"],
  employee: ["payslips", "colleagues", "recruiter", "workplace"],
  founder: ["investor", "startup", "churn", "headcount"],
  student: ["university", "tuition", "campus", "professors"],
  personal: ["pharmacies", "utilities", "relatives", "streaming"],
  "software-developer": ["repositories", "deployment", "changelogs", "codebase"],
  "ecommerce-seller": ["shoppers", "marketplace", "restock", "chargebacks"],
  "content-creator": ["sponsorship", "affiliate", "creators", "monetization"],
  teacher: ["pupil", "classroom", "curriculum", "guardians"],
  "academic-researcher": ["manuscript", "peer", "fellowship", "doctoral"],
  "real-estate-agent": ["escrow", "mortgage", "listings", "appraisal"],
  "nonprofit-leader": ["donor", "fundraising", "volunteer", "trustee"],
};

describe("matchTemplateToProfile", () => {
  it("matches each template from its signature keywords", () => {
    for (const [id, keywords] of Object.entries(SIGNATURE_PROFILES)) {
      expect(matchTemplateToProfile(profile(keywords)).id).toBe(id);
    }
  });

  it("has a signature profile for every template (and vice versa)", () => {
    const templateIds = TAXONOMY_TEMPLATES.map((t) => t.id).sort();
    const signatureIds = Object.keys(SIGNATURE_PROFILES).sort();
    expect(signatureIds).toEqual(templateIds);
  });

  it("is deterministic for the same profile", () => {
    const p = profile(["investor", "startup", "headcount"]);
    expect(matchTemplateToProfile(p).id).toBe(matchTemplateToProfile(p).id);
  });

  it("falls back to the Personal / Family template with no usable signal", () => {
    expect(matchTemplateToProfile(profile([])).id).toBe("personal");
    // A profile whose only tokens match no template also falls back.
    expect(matchTemplateToProfile(profile(["zzzznotoken", "qqqnope"])).id).toBe("personal");
  });

  it("always returns a valid, routable template (root + non-root folders)", () => {
    const t = matchTemplateToProfile(profile(["invoices", "clients"]));
    const roots = t.file.nodes.filter((n) => n.isRoot);
    expect(roots).toHaveLength(1);
    expect(t.file.nodes.filter((n) => !n.isRoot).length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Vocabulary distinctness ──────────────────────────────────────────────────
// The matcher scores unigram token overlap, so templates must not share their
// distinctive vocabulary or an inbox matches several equally. We tokenize folder
// names + descriptions exactly as the matcher does, drop generic filler that
// carries no profession signal, and cap how many meaningful tokens any two
// templates may share. Keep this ceiling tight: raising it to make a pair pass
// hides a real collision — reword the copy instead.

/** Mirrors the tokenizer in matchTemplateToProfile.ts (kept module-private there). */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "your", "you", "are", "our", "this",
  "that", "all", "any", "com", "net", "org", "www", "mail", "email", "inbox",
  "re", "fwd", "to", "of", "in", "on", "at", "by", "or", "a", "an", "is", "it",
]);
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

// Cross-domain filler: structural or generic words that legitimately recur in
// many templates and carry no discriminating profession signal. Excluded from
// the overlap count (but still real matching tokens at runtime).
const GENERIC_TOKENS = new Set([
  "personal", "correspondence", "emails", "unrelated", "work", "records",
  "notices", "notifications", "updates", "requests", "scheduling",
  "communications", "communication", "internal", "external", "business",
  "financial", "finance", "coordination", "activities", "related", "messages",
  "status", "day", "professional", "official", "management", "administration",
  "administrative", "documents", "reports", "services", "invitations",
  "statements", "confirmations", "appointments", "changes", "planning",
  "conversations", "discussions", "threads", "responses", "packages",
  "policies", "policy", "deadlines", "payments", "recurring", "everyday",
  "coverage", "relations", "success", "one", "ones",
  // Hyphenation fragments and common connective verbs/nouns that recur across
  // domains without identifying a profession.
  "pre", "sale", "sign", "ups", "across", "open", "new", "about", "upcoming",
  "approvals", "submissions", "negotiations", "delivery", "feedback",
  "progress", "meetings", "events", "questions", "campaign", "campaigns",
  "tiers", "group", "groups", "reporting", "account", "accounts", "changes",
  "admin", "inquiries", "active", "office",
]);

function signalTokens(templateId: string): Set<string> {
  const template = TAXONOMY_TEMPLATES.find((t) => t.id === templateId)!;
  const tokens = new Set<string>();
  for (const node of template.file.nodes) {
    // Root has no copy; the catch-all is byte-identical in every template.
    if (node.isRoot || node.isCatchAll) continue;
    for (const t of tokenize(node.name)) if (!GENERIC_TOKENS.has(t)) tokens.add(t);
    if (node.description) {
      for (const t of tokenize(node.description)) if (!GENERIC_TOKENS.has(t)) tokens.add(t);
    }
  }
  return tokens;
}

describe("template vocabulary distinctness", () => {
  const MAX_SHARED_TOKENS = 2;

  it("keeps distinctive vocabulary disjoint across every template pair", () => {
    const ids = TAXONOMY_TEMPLATES.map((t) => t.id);
    const tokensById = new Map(ids.map((id) => [id, signalTokens(id)]));
    const offenders: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = tokensById.get(ids[i]!)!;
        const b = tokensById.get(ids[j]!)!;
        const shared = [...a].filter((t) => b.has(t));
        if (shared.length > MAX_SHARED_TOKENS) {
          offenders.push(`${ids[i]} ∩ ${ids[j]}: ${shared.join(", ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
