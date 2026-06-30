import { msg } from "@lingui/core/macro";
import type { I18n, MessageDescriptor } from "@lingui/core";

// Render-edge localization for the pricing table.
//
// The plan DATA (prices, limits, ids, structure) lives in @amarnai/shared/plans,
// which is OUTSIDE the i18n extractor's scan scope. Here in packages/ui (which IS
// scanned) we re-declare every user-visible string from that data as a Lingui
// message, keyed by its English source text. `PricingPlans` resolves each string
// through `trPlan()` at render time, so the data file stays the single source of
// truth and the catalog still picks up the strings. Mirrors the pattern in
// packages/ui/src/emails/queueLabels.ts.
//
// Keys must match the English text in plans.ts exactly. If a source string is
// edited there without updating the key here, `trPlan` falls back to the English
// text (untranslated, never broken). Pure numbers ("500", "10,000") are
// intentionally absent: they render as-is via the fallback.
const PLAN_MESSAGES: Record<string, MessageDescriptor> = {
  // ── Plan names ──
  Personal: msg`Personal`,
  Pro: msg`Pro`,
  Business: msg`Business`,

  // ── Plan taglines ──
  "For individuals trying Amarnai on their own inbox.": msg`For individuals trying Amarnai on their own inbox.`,
  "For power users and small businesses who live in their inbox.": msg`For power users and small businesses who live in their inbox.`,
  "For larger organizations and higher-volume teams.": msg`For larger organizations and higher-volume teams.`,

  // ── Badges ──
  "Most popular": msg`Most popular`,

  // ── Card highlights ──
  "1 free Personal workspace": msg`1 free Personal workspace`,
  "500 threads sorted / month": msg`500 threads sorted / month`,
  "Up to 12 plan nodes": msg`Up to 12 plan nodes`,
  "3 AI drafts / month": msg`3 AI drafts / month`,
  "Up to 10 collaborators": msg`Up to 10 collaborators`,
  "10,000 threads sorted / month": msg`10,000 threads sorted / month`,
  "Unlimited plan nodes": msg`Unlimited plan nodes`,
  "200 AI drafts / month, pooled": msg`200 AI drafts / month, pooled`,
  "Shared plan + review queue": msg`Shared plan + review queue`,
  "Up to 25 collaborators": msg`Up to 25 collaborators`,
  "50,000 threads sorted / month": msg`50,000 threads sorted / month`,
  "1,000 AI drafts / month, pooled": msg`1,000 AI drafts / month, pooled`,
  "Advanced review queue": msg`Advanced review queue`,
  "Admin & review controls": msg`Admin & review controls`,

  // ── CTA labels ──
  "Start free": msg`Start free`,
  "Start 14-day trial": msg`Start 14-day trial`,

  // ── Comparison group names ──
  Workspace: msg`Workspace`,
  "Sorting volume": msg`Sorting volume`,
  "Triage & review": msg`Triage & review`,
  Support: msg`Support`,

  // ── Comparison row labels ──
  "Billing unit": msg`Billing unit`,
  "Workspace type": msg`Workspace type`,
  "Workspaces included": msg`Workspaces included`,
  Collaborators: msg`Collaborators`,
  "Threads sorted / month": msg`Threads sorted / month`,
  "Initial backfill": msg`Initial backfill`,
  "AI drafts": msg`AI drafts`,
  "Plan nodes": msg`Plan nodes`,
  "Shared plan": msg`Shared plan`,
  "Review queue": msg`Review queue`,
  "AI metadata": msg`AI metadata`,
  "Model quality": msg`Model quality`,
  "Gmail label sync": msg`Gmail label sync`,

  // ── Comparison row hints ──
  "Historical threads sorted when you first connect": msg`Historical threads sorted when you first connect`,

  // ── Comparison cell values ──
  "Default free workspace": msg`Default free workspace`,
  "Paid or upgraded Personal": msg`Paid or upgraded Personal`,
  "Paid or upgraded workspace": msg`Paid or upgraded workspace`,
  "1 Personal / user": msg`1 Personal / user`,
  "1 Pro workspace": msg`1 Pro workspace`,
  "1 Business workspace": msg`1 Business workspace`,
  "1 user": msg`1 user`,
  "Up to 10": msg`Up to 10`,
  "Up to 25": msg`Up to 25`,
  "3 / month": msg`3 / month`,
  "200 / month, pooled": msg`200 / month, pooled`,
  "1,000 / month, pooled": msg`1,000 / month, pooled`,
  Unlimited: msg`Unlimited`,
  Basic: msg`Basic`,
  Advanced: msg`Advanced`,
  Full: msg`Full`,
  "Full + admin controls": msg`Full + admin controls`,
  "Standard sorting": msg`Standard sorting`,
  "Enhanced + fallback": msg`Enhanced + fallback`,
  "Enhanced + higher fallback": msg`Enhanced + higher fallback`,
  Soon: msg`Soon`,
  "Community & docs": msg`Community & docs`,
  "Email support": msg`Email support`,
  "Priority support": msg`Priority support`,

  // ── Initial-backfill cell values (deterministic from the shared caps) ──
  "Same as monthly": msg`Same as monthly`,
  "500 threads or last 30 days": msg`500 threads or last 30 days`,
  "10,000 threads": msg`10,000 threads`,
  "50,000 threads": msg`50,000 threads`,
  "75,000 threads": msg`75,000 threads`,
  "250,000 threads": msg`250,000 threads`,

  // ── Self-host note ──
  "Prefer to self-host?": msg`Prefer to self-host?`,
  "Amarnai is open source under AGPL-3.0. Clone it, bring your own keys, and run every tier free on your own infrastructure.": msg`Amarnai is open source under AGPL-3.0. Clone it, bring your own keys, and run every tier free on your own infrastructure.`,
  "Self-host guide": msg`Self-host guide`,
};

// Resolves a plan-data English string to its localized form, falling back to the
// source text when there is no registered message (e.g. pure numbers, or a source
// string edited in plans.ts without a matching key here).
export function trPlan(i18n: I18n, text: string): string {
  const descriptor = PLAN_MESSAGES[text];
  return descriptor ? i18n._(descriptor) : text;
}
