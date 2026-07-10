import { getBackfillCap } from "./backfill-quota.js";

export type PlanId = "free" | "pro" | "business";
export type BillingCycle = "monthly" | "annual";

// ── Initial-backfill labels ──────────────────────────────────────────────────
// Derived from the shared backfill caps so the marketing copy never duplicates
// the numbers. Keep wording here; the caps live in ./backfill-quota.

const PLAN_KEY: Record<PlanId, string> = { free: "FREE", pro: "PRO", business: "BUSINESS" };

/** Format an integer with thousands separators, locale-independently. */
function formatCount(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Human label for a plan's initial backfill at a given billing cycle.
 * `noun` lets callers say "threads" (comparison matrix) or "historical threads"
 * (feature list) while sharing the same underlying cap.
 */
function backfillLabel(
  plan: PlanId,
  cycle: "monthly" | "annual",
  noun: "threads" | "historical threads"
): string {
  const monthly = getBackfillCap(PLAN_KEY[plan], "MONTHLY");
  const cap = getBackfillCap(PLAN_KEY[plan], cycle === "annual" ? "ANNUAL" : "MONTHLY");

  // Plans whose annual cap matches monthly (e.g. Free) collapse to one label.
  if (
    cycle === "annual" &&
    cap.maxThreads === monthly.maxThreads &&
    cap.windowDays === monthly.windowDays
  ) {
    return "Same as monthly";
  }

  if (cap.windowDays != null) {
    return `${formatCount(cap.maxThreads)} threads or last ${cap.windowDays} days`;
  }
  return `${formatCount(cap.maxThreads)} ${noun}`;
}

/** null = coming soon / not yet available */
export type FeatureValue = string | boolean | null;

/** Value in a comparison matrix cell */
export type CellValue =
  | string
  | boolean
  | { soon: string }
  | { note: string };

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  monthlyPrice: number;
  annualMonthlyPrice: number;
  free?: boolean;
  featured?: boolean;
  badge?: string;
  highlights: string[];
  cta: { label: string; kind: "primary" | "secondary" };
}

export interface PlanFeature {
  id: string;
  label: string;
  showInCard: boolean;
  values: Record<PlanId, FeatureValue>;
}

export interface FeatureRow {
  label: string;
  hint?: string;
  values: CellValue[];
}

export interface BillingRow {
  label: string;
  hint?: string;
  billing: Record<BillingCycle, CellValue[]>;
}

export interface FeatureGroup {
  name: string;
  rows: (FeatureRow | BillingRow)[];
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Apprentice",
    tagline: "For trying Amarnai on your own inbox.",
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    free: true,
    highlights: [
      "1 free workspace",
      "500 threads sorted / month",
      "3 reply drafts / month",
      "Up to 12 plan nodes",
    ],
    cta: { label: "Start free", kind: "secondary" },
  },
  {
    id: "pro",
    name: "Scribe",
    tagline: "For your busy inbox as a freelancer, consultant, property manager, or business owner.",
    monthlyPrice: 6,
    annualMonthlyPrice: 5,
    featured: true,
    badge: "Most popular",
    highlights: [
      "Up to 2 people",
      "5,000 threads sorted / month",
      "200 reply drafts / month, pooled",
      "Unlimited plan nodes",
      "Shared plan",
    ],
    cta: { label: "Start 14-day trial", kind: "primary" },
  },
  {
    id: "business",
    name: "Pharaoh",
    tagline: "For your high-volume or shared inbox as a recruiter, agency, or small team on one mailbox.",
    monthlyPrice: 15,
    annualMonthlyPrice: 12,
    highlights: [
      "Up to 3 people",
      "10,000 threads sorted / month",
      "500 reply drafts / month, pooled",
      "Unlimited plan nodes",
      "Shared plan",
    ],
    cta: { label: "Start 14-day trial", kind: "secondary" },
  },
];

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    name: "Workspace",
    rows: [
      { label: "Billing unit", values: ["Workspace", "Workspace", "Workspace"] },
      {
        label: "Workspace type",
        values: [
          "Default free workspace",
          "Paid or upgraded workspace",
          "Paid or upgraded workspace",
        ],
      },
      {
        label: "Workspaces included",
        values: ["1 free workspace / user", "1 Scribe workspace", "1 Pharaoh workspace"],
      },
      { label: "Collaborators", values: ["1 person", "2 people", "3 people"] },
    ],
  },
  {
    name: "Sorting volume",
    rows: [
      {
        label: "Threads sorted / month",
        values: ["500", "5,000", "10,000"],
      },
      {
        label: "Initial backfill",
        hint: "Historical threads sorted when you first connect",
        billing: {
          monthly: [
            backfillLabel("free", "monthly", "threads"),
            backfillLabel("pro", "monthly", "threads"),
            backfillLabel("business", "monthly", "threads"),
          ],
          annual: [
            backfillLabel("free", "annual", "threads"),
            backfillLabel("pro", "annual", "threads"),
            backfillLabel("business", "annual", "threads"),
          ],
        },
      },
      {
        label: "Reply drafts",
        values: ["3 / month", "200 / month, pooled", "500 / month, pooled"],
      },
      {
        label: "Plan nodes",
        values: ["12", { note: "Unlimited" }, { note: "Unlimited" }],
      },
    ],
  },
  {
    name: "Triage & review",
    rows: [
      { label: "Shared plan", values: [false, true, true] },
      {
        label: "Metadata",
        values: ["Basic", "Full", "Full"],
      },
      {
        label: "Model quality",
        values: [
          "Standard sorting",
          "Enhanced + fallback",
          "Enhanced + higher fallback",
        ],
      },
    ],
  },
  {
    name: "Support",
    rows: [
      {
        label: "Support",
        values: ["Community & docs", "Email support", "Priority support"],
      },
    ],
  },
];

export const SELF_HOST_NOTE = {
  title: "Prefer to self-host?",
  body: "Amarnai is open source under AGPL-3.0. Clone it, bring your own keys, and run every tier free on your own infrastructure.",
  cta: { label: "Self-host guide", href: "https://docs.amarnai.com/docs/self-hosting" },
};

export const PLAN_FEATURES: PlanFeature[] = [
  {
    id: "billing_unit",
    label: "Billing unit",
    showInCard: false,
    values: { free: "Workspace", pro: "Workspace", business: "Workspace" },
  },
  {
    id: "collaborators",
    label: "Collaborators",
    showInCard: true,
    values: { free: "1 person", pro: "2 people", business: "3 people" },
  },
  {
    id: "monthly_threads",
    label: "Threads / month",
    showInCard: true,
    values: { free: "500", pro: "5,000", business: "10,000" },
  },
  {
    id: "backfill_monthly",
    label: "Initial backfill (monthly plan)",
    showInCard: false,
    values: {
      free: backfillLabel("free", "monthly", "historical threads"),
      pro: backfillLabel("pro", "monthly", "historical threads"),
      business: backfillLabel("business", "monthly", "historical threads"),
    },
  },
  {
    id: "backfill_annual",
    label: "Initial backfill (annual plan)",
    showInCard: false,
    values: {
      free: backfillLabel("free", "annual", "historical threads"),
      pro: backfillLabel("pro", "annual", "historical threads"),
      business: backfillLabel("business", "annual", "historical threads"),
    },
  },
  {
    id: "ai_drafts",
    label: "Reply drafts / month",
    showInCard: true,
    values: { free: "3", pro: "200 pooled", business: "500 pooled" },
  },
  {
    id: "model_quality",
    label: "Model quality",
    showInCard: true,
    values: {
      free: "Standard sorting",
      pro: "Enhanced sorting + fallback",
      business: "Enhanced sorting + higher fallback budget",
    },
  },
  {
    id: "taxonomy_nodes",
    label: "Plan nodes",
    showInCard: true,
    values: { free: "12", pro: "Unlimited", business: "Unlimited" },
  },
  {
    id: "shared_taxonomy",
    label: "Shared plan",
    showInCard: true,
    values: { free: false, pro: true, business: true },
  },
  {
    id: "gmail_label_sync",
    label: "Gmail label sync",
    showInCard: false,
    values: { free: null, pro: null, business: null },
  },
  {
    id: "support",
    label: "Support",
    showInCard: true,
    values: {
      free: "Community / docs",
      pro: "Email support",
      business: "Priority support",
    },
  },
];
