import type { NotificationItem } from "./types.js";

// Pure, localization-free interpretation of an in-app notification. The type +
// params are producer-defined; this maps them to a discriminated descriptor so
// the type discrimination and param plumbing live here once. Each client turns
// the descriptor into its own localized text — the Lingui catalogs are
// per-app, so the `msg` copy stays at the render edges, not here.

/** Poll cadence for the unread-count badge, shared across web/mobile/extension.
 *  Push covers real-time on mobile; a light foreground poll keeps the badge
 *  fresh without a per-user SSE channel. */
export const NOTIFICATION_POLL_INTERVAL_MS = 60_000;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

/** Workspace plans, whitelisted so an unexpected value degrades to null (which
 *  the client treats as "clickable to upgrade") rather than trusting arbitrary
 *  strings. Only literal "BUSINESS" (the top tier) suppresses the upgrade CTA. */
type WorkspacePlan = "FREE" | "PRO" | "BUSINESS";
function plan(v: unknown): WorkspacePlan | null {
  return v === "FREE" || v === "PRO" || v === "BUSINESS" ? v : null;
}

export type NotificationDescriptor =
  | {
      kind: "thread_assigned";
      /** Assigner's display name or email; null if the params omit both. */
      assignedBy: string | null;
      /** Thread subject, if the producer included one. */
      subject: string | null;
      /** Thread to open on click; null if absent. */
      threadId: string | null;
    }
  | {
      /** One-time nudge to install the browser side-panel extension. Carries no
       *  params; the click target (a store listing) is a client-side config. */
      kind: "extension_not_installed";
    }
  | {
      /** You were @-mentioned in a thread comment. Params never carry the
       *  comment body (user-generated, may quote email content) — the subject
       *  is the only content shown, mirroring thread_assigned. */
      kind: "comment_mention";
      /** Mentioner's display name or email; null if the params omit both. */
      mentionedBy: string | null;
      /** Thread subject, if the producer included one. */
      subject: string | null;
      /** Thread to open on click; null if absent. */
      threadId: string | null;
    }
  | {
      /** The workspace's Gmail connection dropped on an auth failure; triage is
       *  paused until the account is reconnected. */
      kind: "gmail_disconnected";
      /** The disconnected Gmail address, shown in the body; null if absent. */
      gmailAddress: string | null;
    }
  | {
      /** A bulk inbox import (backfill) finished. */
      kind: "backfill_complete";
      /** Threads imported; null if the producer omitted the count. */
      processed: number | null;
      /** Threads skipped (permanent per-thread fetch errors). */
      skipped: number | null;
      /** True if the run stopped at the plan's import cap rather than exhausting. */
      capReached: boolean;
    }
  | {
      /** The monthly thread-sort quota was reached; new mail waits until the
       *  window resets or the plan is upgraded. */
      kind: "quota_blocked";
      /** The workspace's own plan (the upgrade target). "BUSINESS" is the top
       *  tier, so it renders informationally with no upgrade click. Null when the
       *  param is missing or unrecognized — still clickable. */
      plan: WorkspacePlan | null;
    }
  | { kind: "unknown" };

/**
 * Interpret a notification's type + params into a typed descriptor. Add a case
 * per producer; unknown types fall through to `{ kind: "unknown" }`, which each
 * client renders as a neutral fallback.
 */
export function interpretNotification(n: NotificationItem): NotificationDescriptor {
  switch (n.type) {
    case "thread_assigned":
      return {
        kind: "thread_assigned",
        assignedBy: str(n.params["assignedByName"]) ?? str(n.params["assignedByEmail"]),
        subject: str(n.params["subject"]),
        threadId: str(n.params["threadId"]),
      };
    case "comment_mention":
      return {
        kind: "comment_mention",
        mentionedBy: str(n.params["mentionedByName"]) ?? str(n.params["mentionedByEmail"]),
        subject: str(n.params["subject"]),
        threadId: str(n.params["threadId"]),
      };
    case "extension_not_installed":
      return { kind: "extension_not_installed" };
    case "gmail_disconnected":
      return {
        kind: "gmail_disconnected",
        gmailAddress: str(n.params["gmailAddress"]),
      };
    case "backfill_complete":
      return {
        kind: "backfill_complete",
        processed: num(n.params["processed"]),
        skipped: num(n.params["skipped"]),
        capReached: bool(n.params["capReached"]),
      };
    case "quota_blocked":
      return {
        kind: "quota_blocked",
        plan: plan(n.params["plan"]),
      };
    default:
      return { kind: "unknown" };
  }
}
