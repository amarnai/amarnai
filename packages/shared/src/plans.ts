import { getBackfillCap } from "./backfill-quota.js";
import type { BillingPlan } from "./billing-state.js";

export type PlanId = "free" | "pro" | "business";
export type BillingCycle = "monthly" | "annual";

/**
 * The marketing plan ids here and the BillingPlan values stored on a workspace
 * name the same tiers. Anything comparing "what the user has" against "what this
 * card offers" needs this bridge.
 */
export const PLAN_TO_BILLING: Record<PlanId, BillingPlan> = {
  free: "FREE",
  pro: "PRO",
  business: "BUSINESS",
};

/** Tier order, for deciding whether a target plan is an upgrade. */
export const PLAN_TIER: Record<BillingPlan, number> = { FREE: 0, PRO: 1, BUSINESS: 2 };

// ── Initial-backfill labels ──────────────────────────────────────────────────
// Derived from the shared backfill caps so the marketing copy never duplicates
// the numbers. Keep wording here; the caps live in ./backfill-quota.

/** Format an integer with thousands separators, locale-independently. */
function formatCount(n: number): string {
  return n.toLocaleString("en-US");
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
  const monthly = getBackfillCap(PLAN_TO_BILLING[plan], "MONTHLY");
  const cap = getBackfillCap(PLAN_TO_BILLING[plan], cycle === "annual" ? "ANNUAL" : "MONTHLY");

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
      "50 threads sorted / month",
      "3 reply drafts / month",
      "50 thread summaries / month",
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
      "5,000 thread summaries / month, pooled",
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
      "10,000 thread summaries / month, pooled",
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
        values: ["50", "5,000", "10,000"],
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
        label: "Thread summaries",
        hint: "AI TL;DR of a thread, generated the first time you open it",
        values: ["50 / month", "5,000 / month, pooled", "10,000 / month, pooled"],
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
  cta: { label: "Self-host guide", href: "https://docs.aziru.email/docs/self-hosting" },
};
