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
  Apprentice: msg`Apprentice`,
  Scribe: msg`Scribe`,
  Pharaoh: msg`Pharaoh`,

  // ── Plan taglines ──
  "For trying Amarnai on your own inbox.": msg`For trying Amarnai on your own inbox.`,
  "For your busy inbox as a freelancer, consultant, property manager, or business owner.": msg`For your busy inbox as a freelancer, consultant, property manager, or business owner.`,
  "For your high-volume or shared inbox as a recruiter, agency, or small team on one mailbox.": msg`For your high-volume or shared inbox as a recruiter, agency, or small team on one mailbox.`,

  // ── Badges ──
  "Most popular": msg`Most popular`,

  // ── Card highlights ──
  "1 free workspace": msg`1 free workspace`,
  "50 threads sorted / month": msg`50 threads sorted / month`,
  "Up to 12 plan nodes": msg`Up to 12 plan nodes`,
  "3 reply drafts / month": msg`3 reply drafts / month`,
  "Up to 2 people": msg`Up to 2 people`,
  "5,000 threads sorted / month": msg`5,000 threads sorted / month`,
  "10,000 threads sorted / month": msg`10,000 threads sorted / month`,
  "Unlimited plan nodes": msg`Unlimited plan nodes`,
  "200 reply drafts / month, pooled": msg`200 reply drafts / month, pooled`,
  "Up to 3 people": msg`Up to 3 people`,
  "500 reply drafts / month, pooled": msg`500 reply drafts / month, pooled`,
  "50 thread summaries / month": msg`50 thread summaries / month`,
  "5,000 thread summaries / month, pooled": msg`5,000 thread summaries / month, pooled`,
  "10,000 thread summaries / month, pooled": msg`10,000 thread summaries / month, pooled`,

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
  "Reply drafts": msg`Reply drafts`,
  "Thread summaries": msg`Thread summaries`,
  "Plan nodes": msg`Plan nodes`,
  "Shared plan": msg`Shared plan`,
  Metadata: msg`Metadata`,
  "Model quality": msg`Model quality`,
  "Gmail label sync": msg`Gmail label sync`,

  // ── Comparison row hints ──
  "Historical threads sorted when you first connect": msg`Historical threads sorted when you first connect`,
  "AI TL;DR of a thread, generated the first time you open it": msg`AI TL;DR of a thread, generated the first time you open it`,

  // ── Comparison cell values ──
  "Default free workspace": msg`Default free workspace`,
  "Paid or upgraded workspace": msg`Paid or upgraded workspace`,
  "1 free workspace / user": msg`1 free workspace / user`,
  "1 Scribe workspace": msg`1 Scribe workspace`,
  "1 Pharaoh workspace": msg`1 Pharaoh workspace`,
  "1 person": msg`1 person`,
  "2 people": msg`2 people`,
  "3 people": msg`3 people`,
  "3 / month": msg`3 / month`,
  "200 / month, pooled": msg`200 / month, pooled`,
  "500 / month, pooled": msg`500 / month, pooled`,
  "50 / month": msg`50 / month`,
  "5,000 / month, pooled": msg`5,000 / month, pooled`,
  "10,000 / month, pooled": msg`10,000 / month, pooled`,
  Unlimited: msg`Unlimited`,
  Basic: msg`Basic`,
  Full: msg`Full`,
  "Standard sorting": msg`Standard sorting`,
  "Enhanced + fallback": msg`Enhanced + fallback`,
  "Enhanced + higher fallback": msg`Enhanced + higher fallback`,
  Soon: msg`Soon`,
  "Community & docs": msg`Community & docs`,
  "Email support": msg`Email support`,
  "Priority support": msg`Priority support`,

  // ── Initial-backfill cell values (deterministic from the shared caps) ──
  "Same as monthly": msg`Same as monthly`,
  "500 threads": msg`500 threads`,
  "10,000 threads": msg`10,000 threads`,
  "20,000 threads": msg`20,000 threads`,
  "50,000 threads": msg`50,000 threads`,
  "75,000 threads": msg`75,000 threads`,

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
