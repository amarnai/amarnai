export type PlanId = "free" | "pro" | "business";
export type BillingCycle = "monthly" | "annual";

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
    name: "Personal",
    tagline: "For individuals trying Amarnai on their own inbox.",
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    free: true,
    highlights: [
      "1 free Personal workspace",
      "500 threads sorted / month",
      "Up to 12 taxonomy nodes",
      "3 AI drafts / month",
    ],
    cta: { label: "Start free", kind: "secondary" },
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For power users and small businesses who live in their inbox.",
    monthlyPrice: 5,
    annualMonthlyPrice: 4,
    featured: true,
    badge: "Most popular",
    highlights: [
      "Up to 10 collaborators",
      "10,000 threads sorted / month",
      "Unlimited taxonomy nodes",
      "200 AI drafts / month, pooled",
      "Shared taxonomy + review queue",
    ],
    cta: { label: "Start 14-day trial", kind: "primary" },
  },
  {
    id: "business",
    name: "Business",
    tagline: "For larger organizations and higher-volume teams.",
    monthlyPrice: 12,
    annualMonthlyPrice: 10,
    highlights: [
      "Up to 25 collaborators",
      "50,000 threads sorted / month",
      "1,000 AI drafts / month, pooled",
      "Advanced review queue",
      "Admin & review controls",
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
          "Paid or upgraded Personal",
          "Paid or upgraded workspace",
        ],
      },
      {
        label: "Workspaces included",
        values: ["1 Personal / user", "1 Pro workspace", "1 Business workspace"],
      },
      { label: "Collaborators", values: ["1 user", "Up to 10", "Up to 25"] },
    ],
  },
  {
    name: "Sorting volume",
    rows: [
      {
        label: "Threads sorted / month",
        values: ["500", "10,000", "50,000"],
      },
      {
        label: "Initial backfill",
        hint: "Historical threads sorted when you first connect",
        billing: {
          monthly: [
            "500 threads or last 30 days",
            "10,000 threads",
            "75,000 threads",
          ],
          annual: ["Same as monthly", "50,000 threads", "250,000 threads"],
        },
      },
      {
        label: "AI drafts",
        values: ["3 / month", "200 / month, pooled", "1,000 / month, pooled"],
      },
      {
        label: "Taxonomy nodes",
        values: ["12", { note: "Unlimited" }, { note: "Unlimited" }],
      },
    ],
  },
  {
    name: "Triage & review",
    rows: [
      { label: "Shared taxonomy", values: [false, true, true] },
      { label: "Review queue", values: [false, "Basic", "Advanced"] },
      {
        label: "AI metadata",
        values: ["Basic", "Full", "Full + admin controls"],
      },
      {
        label: "Model quality",
        values: [
          "Standard sorting",
          "Enhanced + fallback",
          "Enhanced + higher fallback",
        ],
      },
      {
        label: "Gmail label sync",
        values: [{ soon: "Soon" }, { soon: "Soon" }, { soon: "Soon" }],
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
    values: { free: "1", pro: "Up to 10", business: "Up to 25" },
  },
  {
    id: "monthly_threads",
    label: "Threads / month",
    showInCard: true,
    values: { free: "500", pro: "10,000", business: "50,000" },
  },
  {
    id: "backfill_monthly",
    label: "Initial backfill (monthly plan)",
    showInCard: false,
    values: {
      free: "500 threads or last 30 days",
      pro: "10,000 historical threads",
      business: "75,000 historical threads",
    },
  },
  {
    id: "backfill_annual",
    label: "Initial backfill (annual plan)",
    showInCard: false,
    values: {
      free: "Same as monthly",
      pro: "50,000 historical threads",
      business: "250,000 historical threads",
    },
  },
  {
    id: "ai_drafts",
    label: "AI drafts / month",
    showInCard: true,
    values: { free: "3", pro: "200 pooled", business: "1,000 pooled" },
  },
  {
    id: "model_quality",
    label: "AI model quality",
    showInCard: true,
    values: {
      free: "Standard sorting",
      pro: "Enhanced sorting + fallback",
      business: "Enhanced sorting + higher fallback budget",
    },
  },
  {
    id: "taxonomy_nodes",
    label: "Taxonomy nodes",
    showInCard: true,
    values: { free: "12", pro: "Unlimited", business: "Unlimited" },
  },
  {
    id: "shared_taxonomy",
    label: "Shared taxonomy",
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
    id: "review_queue",
    label: "Review queue",
    showInCard: true,
    values: { free: false, pro: "Basic", business: "Advanced" },
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
