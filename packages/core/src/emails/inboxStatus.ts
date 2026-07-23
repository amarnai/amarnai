import { TAXONOMY_MIN_NON_ROOT_NODES } from "@amarnai/shared";
import type { BackfillStatus, BackfillLimitState } from "@amarnai/api-client";

export type WorkspacePlan = "FREE" | "PRO" | "BUSINESS";

// Everything the sorting-status decision needs, all already loaded by the
// triage view-model + sync-status. Kept i18n-free: the extractor does not scan
// packages/core, so surfaces build the localized copy from this structured
// result (see the extension's StatusSlot).
export type InboxStatusInput = {
  /** Threads waiting to be routed (PENDING_WAITING + UNROUTED). */
  waitingCount: number;
  /** Routable folders in the taxonomy (folders.length). */
  routableNodeCount: number;
  /** Total threads loaded for the workspace — drives the empty takeover. */
  threadCount: number;
  backfillStatus: BackfillStatus;
  backfillRoutingStarted: boolean;
  backfillLimitState: BackfillLimitState;
  backfillAwaitingTaxonomy: boolean;
  workspacePlan: WorkspacePlan;
  /** Session-dismissed the plan-cap notice. */
  planCapDismissed: boolean;
};

// The single state a surface should show. `no-plan-empty` is a full-pane
// takeover (nothing to list); every other kind is one pinned row. Ordered by
// priority in resolveInboxStatus below.
export type InboxStatus =
  | { kind: "no-plan-empty" }
  | { kind: "no-plan"; waitingCount: number }
  | { kind: "pending"; waitingCount: number }
  | { kind: "plan-cap"; limitState: Exclude<BackfillLimitState, "NONE">; plan: WorkspacePlan }
  | { kind: "backfill"; awaitingTaxonomy: boolean };

/**
 * Resolve the one sorting-status state a narrow surface (the browser-extension
 * side panel) should show, or null for none. Priority is actionable-before-
 * informational: fixing "no plan" or clearing the backlog outranks the
 * dismissible import-cap notice, which outranks backfill progress. Connection
 * problems are handled upstream (a full-pane gate), so they are not modelled
 * here.
 *
 * Wider surfaces (web) stack their banners and only need the per-state
 * predicates; this single-winner selector is for the pinned-slot surfaces.
 */
export function resolveInboxStatus(input: InboxStatusInput): InboxStatus | null {
  const taxonomyWeak = input.routableNodeCount < TAXONOMY_MIN_NON_ROOT_NODES;

  // Exception (full pane, not the slot): nothing in the inbox and no plan to
  // sort into — there is no list to pin a row over, so hand the user to the
  // plan editor. The moment any thread exists this collapses to "no-plan".
  if (input.threadCount === 0 && taxonomyWeak) return { kind: "no-plan-empty" };

  // 01 — a backlog exists but the taxonomy is too small to route into.
  if (input.waitingCount > 0 && taxonomyWeak) {
    return { kind: "no-plan", waitingCount: input.waitingCount };
  }

  // 02 — backlog ready to sort (plan exists, routing not yet armed). Once
  // routing has started the sweep picks up newly imported threads on its own,
  // so the CTA is done — mirror the web banner and drop it.
  if (input.waitingCount > 0 && !input.backfillRoutingStarted) {
    return { kind: "pending", waitingCount: input.waitingCount };
  }

  // 03 — the monthly import limit was reached (informational, dismissible).
  if (input.backfillLimitState !== "NONE" && !input.planCapDismissed) {
    return { kind: "plan-cap", limitState: input.backfillLimitState, plan: input.workspacePlan };
  }

  // 04 — historical backfill is still importing past threads.
  if (input.backfillStatus === "RUNNING") {
    return { kind: "backfill", awaitingTaxonomy: input.backfillAwaitingTaxonomy };
  }

  return null;
}
