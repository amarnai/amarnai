/**
 * Behavioral tests for pre-LLM candidate node selection.
 *
 * Tests validate that the selector returns a ranked list of destination nodes
 * with sensible relative ordering — more semantically relevant nodes rank above
 * less relevant ones. Tests are algorithm-agnostic: they do not assert specific
 * scores, weights, thresholds, or formula details. Only observable behavioral
 * outcomes are tested.
 *
 * Taxonomy under test:
 *
 *   Inbox [root]
 *   ├── Work            desc: "professional office employment business staff"
 *   │   ├── Legal       desc: "legal contracts law compliance regulation"
 *   │   │   ├── Contracts desc: "agreements negotiations signing renewal supplier"
 *   │   │   └── Disputes  desc: "litigation arbitration conflict claims resolution"
 *   │   └── Finance     desc: "accounting budget financial reporting audit"
 *   │       ├── Invoice   desc: "billing accounts receivable payment vendor"
 *   │       └── Payroll   desc: "salary wages compensation employees benefits"
 *   ├── Events          desc: "events venue booking organization hosting"
 *   │   ├── Conferences desc: "conference seminar workshop gathering speakers"
 *   │   └── Ceremonies  desc: "ceremony ritual celebration formal occasion"
 *   │       ├── Weddings  desc: "wedding marriage bridal venue celebration"
 *   │       └── Funerals  desc: "funeral memorial bereavement mourning service"
 *   ├── Press           desc: "media communication public relations outreach"
 *   │   ├── Interview   desc: "journalist reporter interview appearance broadcast"
 *   │   └── Releases    desc: "announcement publication news statement"
 *   └── Other           desc: "unclassified general miscellaneous fallback"
 *
 * Tree properties:
 *   - 4 depth levels (root + 3 branch levels)
 *   - Parent nodes are valid destinations alongside their children
 *   - Sibling clusters at multiple levels
 *   - A named fallback node ("Other")
 *   - 16 non-root nodes
 */
import { describe, it, expect } from "vitest";
import { selectCandidateNodes } from "../selection/candidate-selector.js";
import type { EmailInput, CandidateNode } from "../selection/candidate-selector.js";
import type { TaxonomyNodeInput, TaxonomyEdgeInput } from "../types.js";

// ─── Fixture helpers ───────────────────────────────────────────────────────────

function n(
  id: string,
  name: string,
  description: string | null = null,
  opts: Partial<TaxonomyNodeInput> = {}
): TaxonomyNodeInput {
  return { id, name, description, instructions: null, examples: [], isRoot: false, ...opts };
}

function e(id: string, src: string, tgt: string): TaxonomyEdgeInput {
  return { id, sourceNodeId: src, targetNodeId: tgt };
}

// ─── Complex taxonomy nodes ────────────────────────────────────────────────────

const ROOT       = n("root",       "Inbox",       null,                                                    { isRoot: true });
const WORK       = n("work",       "Work",        "professional office employment business staff");
const LEGAL      = n("legal",      "Legal",       "legal contracts law compliance regulation");
const CONTRACTS  = n("contracts",  "Contracts",   "agreements negotiations signing renewal supplier");
const DISPUTES   = n("disputes",   "Disputes",    "litigation arbitration conflict claims resolution");
const FINANCE    = n("finance",    "Finance",     "accounting budget financial reporting audit");
const INVOICE    = n("invoice",    "Invoice",     "billing accounts receivable payment vendor");
const PAYROLL    = n("payroll",    "Payroll",     "salary wages compensation employees benefits");
const EVENTS     = n("events",     "Events",      "events venue booking organization hosting");
const CONFERENCES= n("conferences","Conferences", "conference seminar workshop gathering speakers");
const CEREMONIES = n("ceremonies", "Ceremonies",  "ceremony ritual celebration formal occasion");
const WEDDINGS   = n("weddings",   "Weddings",    "wedding marriage bridal venue celebration");
const FUNERALS   = n("funerals",   "Funerals",    "funeral memorial bereavement mourning service");
const PRESS      = n("press",      "Press",       "media communication public relations outreach");
const INTERVIEW  = n("interview",  "Interview",   "journalist reporter interview appearance broadcast");
const RELEASES   = n("releases",   "Releases",    "announcement publication news statement");
const OTHER      = n("other",      "Other",       "unclassified general miscellaneous fallback");

const NODES: TaxonomyNodeInput[] = [
  ROOT, WORK, LEGAL, CONTRACTS, DISPUTES, FINANCE, INVOICE, PAYROLL,
  EVENTS, CONFERENCES, CEREMONIES, WEDDINGS, FUNERALS,
  PRESS, INTERVIEW, RELEASES, OTHER,
];

// ─── Complex taxonomy edges ────────────────────────────────────────────────────

const EDGES: TaxonomyEdgeInput[] = [
  e("e-root-work",        "root",       "work"),
  e("e-root-events",      "root",       "events"),
  e("e-root-press",       "root",       "press"),
  e("e-root-other",       "root",       "other"),
  e("e-work-legal",       "work",       "legal"),
  e("e-work-finance",     "work",       "finance"),
  e("e-legal-contracts",  "legal",      "contracts"),
  e("e-legal-disputes",   "legal",      "disputes"),
  e("e-finance-invoice",  "finance",    "invoice"),
  e("e-finance-payroll",  "finance",    "payroll"),
  e("e-events-conf",      "events",     "conferences"),
  e("e-events-cere",      "events",     "ceremonies"),
  e("e-cere-weddings",    "ceremonies", "weddings"),
  e("e-cere-funerals",    "ceremonies", "funerals"),
  e("e-press-interview",  "press",      "interview"),
  e("e-press-releases",   "press",      "releases"),
];

// ─── Test helpers ──────────────────────────────────────────────────────────────

function runSelect(emails: EmailInput[]) {
  return selectCandidateNodes(NODES, EDGES, emails);
}

/** 0-based rank of a node in the candidate list; -1 if absent. */
function rankOf(candidates: CandidateNode[], nodeId: string): number {
  return candidates.findIndex((c) => c.nodeId === nodeId);
}

/** Score of a node in the candidate list; -1 if absent. */
function scoreOf(candidates: CandidateNode[], nodeId: string): number {
  return candidates.find((c) => c.nodeId === nodeId)?.score ?? -1;
}

// ─── Suite 1: CandidateNode shape and ranking structure ────────────────────────

describe("complex taxonomy — CandidateNode shape", () => {
  // Any email that produces non-trivial scores.
  const result = runSelect([{ bodyText: "invoice billing vendor accounts" }]);

  it("returns a CandidateNode[] (array, not a single winner)", () => {
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("every candidate has a numeric score ≥ 0", () => {
    for (const c of result.candidates) {
      expect(typeof c.score, `score of "${c.nodeId}" should be a number`).toBe("number");
      expect(c.score, `score of "${c.nodeId}" should be ≥ 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it("every candidate exposes nodeId, name, score, reasons, and breadcrumb", () => {
    for (const c of result.candidates) {
      expect(c).toHaveProperty("nodeId");
      expect(c).toHaveProperty("name");
      expect(c).toHaveProperty("score");
      expect(c).toHaveProperty("reasons");
      expect(c).toHaveProperty("breadcrumb");
    }
  });

  it("candidates are ordered by descending score (no score inversion)", () => {
    const scores = result.candidates.map((c) => c.score);
    for (let i = 0; i + 1 < scores.length; i++) {
      expect(
        scores[i]!,
        `score at rank ${i} (${scores[i]}) should be ≥ score at rank ${i + 1} (${scores[i + 1]})`
      ).toBeGreaterThanOrEqual(scores[i + 1]!);
    }
  });

  it("no internal fields (pathId, edgeIds, isFallback) leak into the public result", () => {
    for (const c of result.candidates) {
      expect(c).not.toHaveProperty("pathId");
      expect(c).not.toHaveProperty("edgeIds");
      expect(c).not.toHaveProperty("isFallback");
    }
  });
});

// ─── Suite 2: Ordering stability ──────────────────────────────────────────────

describe("complex taxonomy — ordering is deterministic across repeated calls", () => {
  const emails: EmailInput[] = [
    {
      subject: "Legal contracts and billing invoice compliance",
      bodyText:
        "Please review the legal contracts for compliance. The billing invoice for these legal services needs financial approval.",
    },
  ];

  it("identical input produces identical nodeId ordering", () => {
    const r1 = runSelect(emails);
    const r2 = runSelect(emails);
    expect(r1.candidates.map((c) => c.nodeId)).toEqual(r2.candidates.map((c) => c.nodeId));
  });

  it("identical input produces identical scores", () => {
    const r1 = runSelect(emails);
    const r2 = runSelect(emails);
    expect(r1.candidates.map((c) => c.score)).toEqual(r2.candidates.map((c) => c.score));
  });
});

// ─── Suite 3: Specific child node outranks broad parent ───────────────────────
//
// Email vocabulary is strongly aligned with Invoice (billing, vendor, accounts,
// payment) and also names Finance. The most specific matching node (Invoice)
// should rank above its parent (Finance), which should in turn rank above the
// broader Work branch.

describe("complex taxonomy — specific child node outranks broad parent", () => {
  const emails: EmailInput[] = [
    {
      subject: "Finance department invoice",
      bodyText:
        "Please process the invoice for billing from our vendor. The accounts payable team in the finance department needs to approve before payment.",
    },
  ];
  const result = runSelect(emails);

  it("Invoice (leaf, depth 4) ranks above Finance (parent, depth 3)", () => {
    const invoiceRank = rankOf(result.candidates, "invoice");
    const financeRank = rankOf(result.candidates, "finance");
    expect(invoiceRank, "Invoice should be in candidates").not.toBe(-1);
    expect(financeRank, "Finance should be in candidates").not.toBe(-1);
    expect(invoiceRank).toBeLessThan(financeRank);
  });

  it("Finance (depth 3) ranks above Work (grandparent, depth 2) when both are present, or Work is absent entirely", () => {
    const financeRank = rankOf(result.candidates, "finance");
    const workRank    = rankOf(result.candidates, "work");
    // Finance must be in candidates — it has a direct name match.
    expect(financeRank, "Finance should be in candidates").not.toBe(-1);
    // Work may be absent if it has no relevance to this email's vocabulary.
    // Absence is even stronger evidence that Finance dominates Work.
    if (workRank !== -1) {
      expect(financeRank).toBeLessThan(workRank);
    }
  });

  it("Invoice scores strictly higher than Finance", () => {
    expect(scoreOf(result.candidates, "invoice")).toBeGreaterThan(
      scoreOf(result.candidates, "finance")
    );
  });

  it("Invoice is the top-ranked candidate", () => {
    expect(result.candidates[0]?.nodeId).toBe("invoice");
  });

  it("Invoice and Finance are both present — the full plausible path is surfaced, not just the winner", () => {
    expect(rankOf(result.candidates, "invoice")).not.toBe(-1);
    expect(rankOf(result.candidates, "finance")).not.toBe(-1);
  });
});

// ─── Suite 4: Broad parent outranks weakly matched children ───────────────────
//
// The email uses general event-planning vocabulary (events, booking, hosting)
// without signaling any specific event type. Events (the parent) should rank
// as the primary candidate, with its subcategories ranked below it.

describe("complex taxonomy — broad parent outranks weakly matched children", () => {
  const emails: EmailInput[] = [
    {
      bodyText:
        "We are looking for information about events booking and hosting. Please send us your events calendar and available hosting slots.",
    },
  ];
  const result = runSelect(emails);

  it("Events (parent) ranks above every descendant", () => {
    const eventsRank = rankOf(result.candidates, "events");
    expect(eventsRank, "Events should be in candidates").not.toBe(-1);

    for (const childId of ["conferences", "ceremonies", "weddings", "funerals"]) {
      const childRank = rankOf(result.candidates, childId);
      if (childRank === -1) continue; // not in candidates — fine, even stricter
      expect(eventsRank, `Events should rank above ${childId}`).toBeLessThan(childRank);
    }
  });

  it("Events scores strictly higher than every descendant", () => {
    const eventsScore = scoreOf(result.candidates, "events");
    expect(eventsScore).toBeGreaterThan(0);

    for (const childId of ["conferences", "ceremonies", "weddings", "funerals"]) {
      const childScore = scoreOf(result.candidates, childId);
      if (childScore === -1) continue;
      expect(eventsScore, `Events should score above ${childId}`).toBeGreaterThan(childScore);
    }
  });

  it("Events is the top-ranked candidate", () => {
    expect(result.candidates[0]?.nodeId).toBe("events");
  });

  it("descendant nodes are still present as lower-ranked candidates (not excluded)", () => {
    // Even with low relevance, subcategories should not be silently omitted.
    for (const childId of ["conferences", "ceremonies", "weddings", "funerals"]) {
      expect(rankOf(result.candidates, childId), `${childId} should be in candidates`).not.toBe(-1);
    }
  });
});

// ─── Suite 5: Ambiguous siblings — parent ranks above both children ────────────
//
// The email mentions both Weddings and Funerals within the context of overall
// ceremonies planning, repeating "ceremonies" most frequently. Since neither
// specific child dominates, the parent (Ceremonies) should rank highest as the
// safest shared destination.

describe("complex taxonomy — ambiguous siblings: parent ranks above both children", () => {
  const emails: EmailInput[] = [
    {
      subject: "Ceremonies formal occasion inquiry",
      bodyText:
        "We need ceremonies coordination for formal occasions. Our upcoming weddings and funerals both require ceremonies planning. Please advise on available ceremonies slots.",
    },
  ];
  const result = runSelect(emails);

  it("Ceremonies (parent) ranks above Weddings (child)", () => {
    const ceremRank = rankOf(result.candidates, "ceremonies");
    const weddRank  = rankOf(result.candidates, "weddings");
    expect(ceremRank, "Ceremonies should be in candidates").not.toBe(-1);
    expect(weddRank,  "Weddings should be in candidates").not.toBe(-1);
    expect(ceremRank).toBeLessThan(weddRank);
  });

  it("Ceremonies (parent) ranks above Funerals (child)", () => {
    const ceremRank = rankOf(result.candidates, "ceremonies");
    const funeRank  = rankOf(result.candidates, "funerals");
    expect(funeRank, "Funerals should be in candidates").not.toBe(-1);
    expect(ceremRank).toBeLessThan(funeRank);
  });

  it("Ceremonies scores strictly higher than both Weddings and Funerals", () => {
    const ceremScore = scoreOf(result.candidates, "ceremonies");
    expect(ceremScore).toBeGreaterThan(scoreOf(result.candidates, "weddings"));
    expect(ceremScore).toBeGreaterThan(scoreOf(result.candidates, "funerals"));
  });

  it("Weddings and Funerals are close rivals — both present and within 2 ranks of each other", () => {
    const weddRank = rankOf(result.candidates, "weddings");
    const funeRank = rankOf(result.candidates, "funerals");
    expect(weddRank).not.toBe(-1);
    expect(funeRank).not.toBe(-1);
    // They should be near-tied: neither dominates the other by more than 2 ranks.
    expect(Math.abs(weddRank - funeRank)).toBeLessThanOrEqual(2);
  });

  it("Weddings and Funerals both score higher than zero (they are genuinely relevant)", () => {
    expect(scoreOf(result.candidates, "weddings")).toBeGreaterThan(0);
    expect(scoreOf(result.candidates, "funerals")).toBeGreaterThan(0);
  });
});

// ─── Suite 6: Rival candidates from different branches ────────────────────────
//
// The email strongly signals Conferences (mentioning "conferences" multiple times
// alongside "workshop" and "seminar") and Interview (requesting an interview).
// Both candidates come from separate top-level branches (Events vs Press) and
// both should appear near the top of the ranked list.

describe("complex taxonomy — rival candidates from different branches", () => {
  const emails: EmailInput[] = [
    {
      subject: "Press conferences and interview request",
      bodyText:
        "We are organising press conferences this quarter and would like to request an interview. The conferences programme includes a workshop and seminar with panel interview sessions.",
    },
  ];
  const result = runSelect(emails);

  it("Conferences (Events branch) appears in candidates", () => {
    expect(rankOf(result.candidates, "conferences")).not.toBe(-1);
  });

  it("Interview (Press branch) appears in candidates", () => {
    expect(rankOf(result.candidates, "interview")).not.toBe(-1);
  });

  it("both rivals appear in the top half of the candidate list", () => {
    const half = result.candidates.length / 2;
    expect(rankOf(result.candidates, "conferences")).toBeLessThan(half);
    expect(rankOf(result.candidates, "interview")).toBeLessThan(half);
  });

  it("Conferences (higher-scoring rival) ranks above Interview", () => {
    expect(rankOf(result.candidates, "conferences")).toBeLessThan(
      rankOf(result.candidates, "interview")
    );
  });

  it("both rivals score strictly higher than Payroll and Disputes (unrelated nodes)", () => {
    const confScore = scoreOf(result.candidates, "conferences");
    const intScore  = scoreOf(result.candidates, "interview");
    for (const unrelatedId of ["payroll", "disputes"]) {
      const s = scoreOf(result.candidates, unrelatedId);
      // -1 means not in list; treat as 0 for comparison
      const unrelatedScore = s === -1 ? 0 : s;
      expect(confScore).toBeGreaterThan(unrelatedScore);
      expect(intScore).toBeGreaterThan(unrelatedScore);
    }
  });

  it("unrelated deep-branch nodes rank below both rivals", () => {
    // worst rank among the two rivals (higher index = lower rank)
    const topRivalRank = Math.max(
      rankOf(result.candidates, "conferences"),
      rankOf(result.candidates, "interview")
    );
    for (const unrelatedId of ["payroll", "disputes", "weddings", "funerals"]) {
      const rank = rankOf(result.candidates, unrelatedId);
      if (rank === -1) continue; // absent is stricter than just ranked below
      expect(rank, `${unrelatedId} should rank below both rivals`).toBeGreaterThan(topRivalRank);
    }
  });
});

// ─── Suite 7: Multi-branch ambiguous email ────────────────────────────────────
//
// The email spans Legal vocabulary (contracts, compliance) and Finance vocabulary
// (billing, invoice). Plausible candidates from both branches should appear,
// and completely unrelated branches should rank below them.

describe("complex taxonomy — multi-branch ambiguous email", () => {
  const emails: EmailInput[] = [
    {
      subject: "Legal contracts and billing invoice compliance",
      bodyText:
        "Please review the legal contracts for compliance. The billing invoice for these legal services needs financial approval. Contracts compliance must be verified before invoice processing.",
    },
  ];
  const result = runSelect(emails);

  it("returns a list of ranked CandidateNode[] (not a single winner)", () => {
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("candidates from both the Legal branch and the Finance branch are present", () => {
    const legalBranchIds  = ["legal", "contracts", "disputes"];
    const financeBranchIds = ["invoice", "payroll", "finance"];
    const hasLegal   = legalBranchIds.some((id) => rankOf(result.candidates, id) !== -1);
    const hasFinance = financeBranchIds.some((id) => rankOf(result.candidates, id) !== -1);
    expect(hasLegal,   "at least one Legal-branch node should appear").toBe(true);
    expect(hasFinance, "at least one Finance-branch node should appear").toBe(true);
  });

  it("Legal (branch parent) ranks above Contracts (its child)", () => {
    const legalRank     = rankOf(result.candidates, "legal");
    const contractsRank = rankOf(result.candidates, "contracts");
    expect(legalRank,     "Legal should be in candidates").not.toBe(-1);
    expect(contractsRank, "Contracts should be in candidates").not.toBe(-1);
    expect(legalRank).toBeLessThan(contractsRank);
  });

  it("Invoice (leaf) ranks above Finance (its direct parent)", () => {
    const invoiceRank = rankOf(result.candidates, "invoice");
    const financeRank = rankOf(result.candidates, "finance");
    expect(invoiceRank, "Invoice should be in candidates").not.toBe(-1);
    expect(financeRank, "Finance should be in candidates").not.toBe(-1);
    expect(invoiceRank).toBeLessThan(financeRank);
  });

  it("all four relevant nodes are present in the candidate list", () => {
    for (const id of ["legal", "contracts", "invoice", "finance"]) {
      expect(rankOf(result.candidates, id), `${id} should be in candidates`).not.toBe(-1);
    }
  });

  it("completely unrelated branch nodes (Weddings, Funerals, Interview, Releases) rank below all relevant nodes", () => {
    const relevantRanks = ["legal", "contracts", "invoice", "finance"]
      .map((id) => rankOf(result.candidates, id))
      .filter((r) => r !== -1);
    const worstRelevantRank = Math.max(...relevantRanks);

    for (const unrelatedId of ["weddings", "funerals", "interview", "releases"]) {
      const rank = rankOf(result.candidates, unrelatedId);
      if (rank === -1) continue; // absent is even stricter
      expect(
        rank,
        `${unrelatedId} (unrelated) should rank below all relevant candidates`
      ).toBeGreaterThan(worstRelevantRank);
    }
  });
});

// ─── Suite 8: Poor taxonomy fit — no strong candidates ────────────────────────
//
// Email with vocabulary that has zero token overlap with any node in the taxonomy.
// All candidates score 0. The zero-score warning must fire.
// The fallback node ("Other") must still appear as an escape hatch.

describe("complex taxonomy — poor taxonomy fit: no strong candidates", () => {
  const emails: EmailInput[] = [
    {
      subject: "Quarterly xyzzy summary",
      bodyText:
        "Zymurgy qqqq glyph aaaa completely unrelated terminology with no taxonomy overlap. Blorb frumple snigglet.",
    },
  ];
  const result = runSelect(emails);

  it("all candidate scores are zero when there is no token overlap", () => {
    const allZero = result.candidates.every((c) => c.score === 0);
    expect(allZero).toBe(true);
  });

  it("emits a warning about zero scores", () => {
    expect(result.diagnostics.warnings.some((w) => /zero/i.test(w))).toBe(true);
  });

  it("the fallback node (Other) is present in the candidate list", () => {
    expect(rankOf(result.candidates, "other")).not.toBe(-1);
  });

  it("the candidate list is non-empty even when nothing matches", () => {
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("the root node (Inbox) is never a candidate destination", () => {
    expect(rankOf(result.candidates, "root")).toBe(-1);
  });
});

// ─── Suite 9: Semantic ranking — relevant nodes surface above irrelevant ones ──
//
// Cross-checks that the ranked output reflects real semantic relevance:
// nodes that match the email vocabulary rank above nodes that do not, and
// the primary match becomes the top candidate.

describe("complex taxonomy — semantically relevant nodes outrank irrelevant ones", () => {
  it("the primary matching node is the top-ranked candidate", () => {
    // Email is unambiguously about payroll — Payroll should be ranked first.
    const emails: EmailInput[] = [{ bodyText: "payroll salary wages" }];
    const result = runSelect(emails);

    expect(result.candidates[0]?.nodeId).toBe("payroll");
  });

  it("directly relevant nodes rank above unrelated ones", () => {
    // Email about payroll and salaries has no connection to Events or Press.
    const emails: EmailInput[] = [{ bodyText: "payroll salary wages compensation" }];
    const result = runSelect(emails);

    const payrollRank = rankOf(result.candidates, "payroll");
    expect(payrollRank, "Payroll should be in candidates").not.toBe(-1);

    for (const unrelatedId of ["events", "conferences", "press", "interview"]) {
      const unrelatedRank = rankOf(result.candidates, unrelatedId);
      if (unrelatedRank === -1) continue; // absent is even stricter
      expect(payrollRank, `Payroll should rank above ${unrelatedId}`).toBeLessThan(unrelatedRank);
    }
  });

  it("nodes with relevant description vocabulary are surfaced as candidates", () => {
    // Email mentions billing/accounts — Invoice's description matches even though
    // the word "invoice" does not appear in the email.
    const emails: EmailInput[] = [{ bodyText: "billing accounts receivable" }];
    const result = runSelect(emails);

    expect(
      rankOf(result.candidates, "invoice"),
      "Invoice should appear as a candidate despite its name not being in the email"
    ).not.toBe(-1);
  });

  it("general category vocabulary prioritizes the category node over its subcategories", () => {
    // Email only mentions "events" — not any specific event type.
    // Events (the parent) should rank above Conferences, Ceremonies, etc.
    const emails: EmailInput[] = [{ bodyText: "events planning" }];
    const result = runSelect(emails);

    const eventsRank = rankOf(result.candidates, "events");
    expect(eventsRank, "Events should be in candidates").not.toBe(-1);

    for (const subcategoryId of ["conferences", "ceremonies", "weddings", "funerals"]) {
      const subcategoryRank = rankOf(result.candidates, subcategoryId);
      if (subcategoryRank === -1) continue; // absent is fine — even less relevant
      expect(eventsRank, `Events should rank above ${subcategoryId}`).toBeLessThan(subcategoryRank);
    }
  });
});
