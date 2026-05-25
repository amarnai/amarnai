/**
 * Three taxonomy fixtures designed to stress-test algorithm behaviour that
 * the flat benchmark topology cannot expose.
 *
 * Each topology has ≥15 nodes across ≥3 levels.
 */
import type { TaxonomyNodeInput, TaxonomyEdgeInput } from "../types.js";
import type { TaxonomyFixture } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(
  id: string,
  name: string,
  description: string | null,
  isRoot = false
): TaxonomyNodeInput {
  return { id, name, description, instructions: null, examples: [], isRoot };
}

function e(id: string, src: string, tgt: string): TaxonomyEdgeInput {
  return { id, sourceNodeId: src, targetNodeId: tgt };
}

// ─── Topology A — Funnel ──────────────────────────────────────────────────────
//
// Single-child chains expose the key pathological case for θ_descent:
//   Δ = 1.0 trivially (only one sibling), so the spread check always passes.
//   Without θ_descent > 0 the algorithm descends unconditionally into any child
//   regardless of raw_sim.
//
// Structure (18 nodes, depth 4):
//   root
//   ├── ChainA  →  ChainA1  →  ChainA2  →  ChainA3  [single-child chain, depth 4]
//   ├── ChainB  →  ChainB1  →  ChainB2               [single-child chain, depth 3]
//   ├── BranchC  →  C1, C2                            [normal 2-child node]
//   └── BranchD  →  D1, D2, D3                       [normal 3-child node]

const FUNNEL_NODES: TaxonomyNodeInput[] = [
  n("f-root", "Inbox", null, true),
  // Single-child chain A (depth 4)
  n("f-chain-a",  "Operations",                   "Operational correspondence, process coordination, and administrative logistics."),
  n("f-chain-a1", "Operations / Scheduling",      "Scheduling and calendar coordination for internal and external meetings."),
  n("f-chain-a2", "Operations / Scheduling / Recurring",    "Recurring meeting series and standing appointment management."),
  n("f-chain-a3", "Operations / Scheduling / Recurring / Weekly", "Weekly recurring meetings and standing weekly briefings."),
  // Single-child chain B (depth 3)
  n("f-chain-b",  "Sales",                        "Sales inquiries, new business development, and inbound commercial leads."),
  n("f-chain-b1", "Sales / Inbound",              "Inbound sales leads, prospect enquiries, and first-contact business requests."),
  n("f-chain-b2", "Sales / Inbound / Qualified",  "Qualified inbound leads in active sales development with confirmed budget and timeline."),
  // Normal branch C (2 children)
  n("f-branch-c",  "Finance",          "Financial correspondence, billing enquiries, and payment-related requests."),
  n("f-c1",        "Finance / Billing",   "Invoice processing, billing disputes, and accounts-receivable enquiries."),
  n("f-c2",        "Finance / Expenses",  "Expense report submissions, reimbursement requests, and budget approvals."),
  // Normal branch D (3 children)
  n("f-branch-d",  "External Relations", "Press, partnerships, and external stakeholder communications."),
  n("f-d1", "External Relations / Media",        "Press interviews, media appearances, and journalist inquiries."),
  n("f-d2", "External Relations / Partnerships", "Sponsorship proposals, co-branding, and commercial partnerships."),
  n("f-d3", "External Relations / Conferences",  "Conference invitations, speaking engagements, and panel requests."),
];

const FUNNEL_EDGES: TaxonomyEdgeInput[] = [
  e("fe-r-ca",  "f-root",    "f-chain-a"),
  e("fe-r-cb",  "f-root",    "f-chain-b"),
  e("fe-r-cc",  "f-root",    "f-branch-c"),
  e("fe-r-cd",  "f-root",    "f-branch-d"),
  // Chain A
  e("fe-ca-a1", "f-chain-a",  "f-chain-a1"),
  e("fe-a1-a2", "f-chain-a1", "f-chain-a2"),
  e("fe-a2-a3", "f-chain-a2", "f-chain-a3"),
  // Chain B
  e("fe-cb-b1", "f-chain-b",  "f-chain-b1"),
  e("fe-b1-b2", "f-chain-b1", "f-chain-b2"),
  // Branch C
  e("fe-cc-c1", "f-branch-c", "f-c1"),
  e("fe-cc-c2", "f-branch-c", "f-c2"),
  // Branch D
  e("fe-cd-d1", "f-branch-d", "f-d1"),
  e("fe-cd-d2", "f-branch-d", "f-d2"),
  e("fe-cd-d3", "f-branch-d", "f-d3"),
];

export const FUNNEL: TaxonomyFixture = {
  name: "Funnel (single-child chains)",
  nodes: FUNNEL_NODES,
  edges: FUNNEL_EDGES,
};

// ─── Topology B — Wide and Shallow ────────────────────────────────────────────
//
// Root has 7 direct children, each with 2–3 children of their own, depth 2.
// No single-child nodes. Tests whether the spread check behaves appropriately
// when many siblings compete at root level (cross-branch LLM trigger frequency)
// and whether θ_descent ever becomes the binding constraint when children are
// already plentiful.
//
// Structure (22 nodes, depth 2):
//   root → 7 branches, each with 2–3 leaf children

const WIDE_NODES: TaxonomyNodeInput[] = [
  n("w-root", "Inbox", null, true),
  // 7 top-level branches
  n("w-sales",         "Sales",          "Sales inquiries, commercial proposals, and new business leads."),
  n("w-support",       "Customer Support","Customer help requests, issue reports, and technical support tickets."),
  n("w-legal",         "Legal",          "Legal document requests, contract reviews, and compliance matters."),
  n("w-finance",       "Finance",        "Invoice processing, billing inquiries, and payment requests."),
  n("w-hr",            "HR",             "Job applications, recruitment inquiries, and employee onboarding."),
  n("w-partnerships",  "Partnerships",   "Partnership proposals, co-marketing, and integration agreements."),
  n("w-security",      "Security",       "Security vulnerability disclosures, incident reports, and access control."),
  // Leaves under Sales
  n("w-sales-inbound",  "Sales / Inbound",  "Inbound sales leads, prospect enquiries, and demo requests."),
  n("w-sales-outbound", "Sales / Outbound", "Outbound sales campaigns, cold outreach, and prospecting."),
  // Leaves under Customer Support
  n("w-sup-technical",  "Customer Support / Technical", "Technical product issues, bug reports, and system error resolution."),
  n("w-sup-billing",    "Customer Support / Billing",   "Billing-related support requests and payment issue escalations."),
  // Leaves under Legal
  n("w-leg-contracts",  "Legal / Contracts",   "Contract drafting, NDA review, and agreement sign-off."),
  n("w-leg-compliance", "Legal / Compliance",  "Regulatory compliance, policy review, and audit inquiries."),
  n("w-leg-disputes",   "Legal / Disputes",    "Legal disputes, arbitration requests, and litigation support."),
  // Leaves under Finance
  n("w-fin-invoice",  "Finance / Invoice", "Invoice processing, accounts-receivable, and payment tracking."),
  n("w-fin-expense",  "Finance / Expense", "Expense report submission, reimbursement, and budget requests."),
  // Leaves under HR
  n("w-hr-recruit", "HR / Recruitment", "Job applications, interview scheduling, and hiring processes."),
  n("w-hr-onboard", "HR / Onboarding",  "New employee onboarding, orientation logistics, and access provisioning."),
  // Leaves under Partnerships
  n("w-par-cobrand",   "Partnerships / Co-brand",    "Co-branding and joint-publication partnership proposals."),
  n("w-par-integrate", "Partnerships / Integration", "Technology integration agreements and API partnership requests."),
  // Leaves under Security
  n("w-sec-vuln",     "Security / Vulnerability", "Security vulnerability disclosures and responsible reporting."),
  n("w-sec-incident", "Security / Incident",      "Security incident response, breach reports, and remediation requests."),
];

const WIDE_EDGES: TaxonomyEdgeInput[] = [
  e("we-r-sal", "w-root", "w-sales"),
  e("we-r-sup", "w-root", "w-support"),
  e("we-r-leg", "w-root", "w-legal"),
  e("we-r-fin", "w-root", "w-finance"),
  e("we-r-hr",  "w-root", "w-hr"),
  e("we-r-par", "w-root", "w-partnerships"),
  e("we-r-sec", "w-root", "w-security"),
  // Under Sales
  e("we-sal-in",  "w-sales", "w-sales-inbound"),
  e("we-sal-out", "w-sales", "w-sales-outbound"),
  // Under Customer Support
  e("we-sup-tec", "w-support", "w-sup-technical"),
  e("we-sup-bil", "w-support", "w-sup-billing"),
  // Under Legal
  e("we-leg-con", "w-legal", "w-leg-contracts"),
  e("we-leg-com", "w-legal", "w-leg-compliance"),
  e("we-leg-dis", "w-legal", "w-leg-disputes"),
  // Under Finance
  e("we-fin-inv", "w-finance", "w-fin-invoice"),
  e("we-fin-exp", "w-finance", "w-fin-expense"),
  // Under HR
  e("we-hr-rec", "w-hr", "w-hr-recruit"),
  e("we-hr-onb", "w-hr", "w-hr-onboard"),
  // Under Partnerships
  e("we-par-cob", "w-partnerships", "w-par-cobrand"),
  e("we-par-int", "w-partnerships", "w-par-integrate"),
  // Under Security
  e("we-sec-vul", "w-security", "w-sec-vuln"),
  e("we-sec-inc", "w-security", "w-sec-incident"),
];

export const WIDE_SHALLOW: TaxonomyFixture = {
  name: "Wide & Shallow (7 branches × 2–3 leaves)",
  nodes: WIDE_NODES,
  edges: WIDE_EDGES,
};

// ─── Topology C — Asymmetric ──────────────────────────────────────────────────
//
// One deep branch (5 levels) alongside several shallow branches (1–2 levels).
// Tests whether λ accumulation prevents over-descent into irrelevant deep nodes
// and whether θ_descent is needed to stop the algorithm at intermediate levels
// when the signal weakens with depth.
//
// Structure (17 nodes):
//   root
//   ├── DeepBranch  →  L1  →  L2  →  L3  →  L4  (5-level chain)
//   ├── MidA  →  MidA1, MidA2
//   ├── MidB  →  MidB1, MidB2
//   ├── LeafX  (direct leaf)
//   ├── LeafY  (direct leaf)
//   └── LeafZ  (direct leaf)

const ASYM_NODES: TaxonomyNodeInput[] = [
  n("a-root", "Inbox", null, true),
  // Deep branch (5 levels)
  n("a-deep",   "Technical Support",                       "Technical support inquiries, API issues, and platform integration problems."),
  n("a-l1",     "Technical Support / API",                 "API integration issues, SDK problems, and developer support requests."),
  n("a-l2",     "Technical Support / API / Authentication","API authentication errors, token issues, and OAuth integration problems."),
  n("a-l3",     "Technical Support / API / Authentication / OAuth", "OAuth 2.0 configuration, authorization flow errors, and scopes troubleshooting."),
  n("a-l4",     "Technical Support / API / Authentication / OAuth / Token Refresh", "OAuth token refresh failures, expiry issues, and refresh-token lifecycle problems."),
  // Mid branch A (2 children)
  n("a-mid-a",  "Finance",           "Financial correspondence and billing-related requests."),
  n("a-mida1",  "Finance / Invoice", "Invoice processing, billing disputes, and accounts-receivable enquiries."),
  n("a-mida2",  "Finance / Expense", "Expense report submissions and reimbursement requests."),
  // Mid branch B (2 children)
  n("a-mid-b",  "Sales",             "Sales correspondence and commercial enquiries."),
  n("a-midb1",  "Sales / Inbound",   "Inbound sales leads, prospect enquiries, and demo requests."),
  n("a-midb2",  "Sales / Outbound",  "Outbound campaigns, cold outreach, and prospecting."),
  // Direct leaves
  n("a-leaf-x", "HR",          "Job applications, recruitment inquiries, and employee onboarding."),
  n("a-leaf-y", "Partnerships","Partnership proposals, co-marketing, and integration agreements."),
  n("a-leaf-z", "Operations",  "Operational coordination, scheduling, and administrative requests."),
];

const ASYM_EDGES: TaxonomyEdgeInput[] = [
  e("ae-r-deep",  "a-root",  "a-deep"),
  e("ae-r-mida",  "a-root",  "a-mid-a"),
  e("ae-r-midb",  "a-root",  "a-mid-b"),
  e("ae-r-lx",    "a-root",  "a-leaf-x"),
  e("ae-r-ly",    "a-root",  "a-leaf-y"),
  e("ae-r-lz",    "a-root",  "a-leaf-z"),
  // Deep chain
  e("ae-deep-l1", "a-deep",  "a-l1"),
  e("ae-l1-l2",   "a-l1",    "a-l2"),
  e("ae-l2-l3",   "a-l2",    "a-l3"),
  e("ae-l3-l4",   "a-l3",    "a-l4"),
  // Mid A
  e("ae-ma-1", "a-mid-a", "a-mida1"),
  e("ae-ma-2", "a-mid-a", "a-mida2"),
  // Mid B
  e("ae-mb-1", "a-mid-b", "a-midb1"),
  e("ae-mb-2", "a-mid-b", "a-midb2"),
];

export const ASYMMETRIC: TaxonomyFixture = {
  name: "Asymmetric (5-level deep branch + shallow peers)",
  nodes: ASYM_NODES,
  edges: ASYM_EDGES,
};
