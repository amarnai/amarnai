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
    case "extension_not_installed":
      return { kind: "extension_not_installed" };
    default:
      return { kind: "unknown" };
  }
}
