import { msg } from "@lingui/core/macro";
import type { I18n } from "@lingui/core";
import type { NotificationItem } from "@amarnai/api-client";

// A notification rendered for display: a one-line title, an optional collapsible
// body (present only for types that carry detail), and an optional action target
// (a thread to open). Feature-agnostic: add a case per producer in
// `describeNotification`. Kept per-platform because the Lingui catalogs differ;
// this mirrors the mobile/extension renderers.
export type NotificationView = {
  title: string;
  /** Collapsible detail line; null when the type has no body. */
  body: string | null;
  /** Thread to open when the row's action button is used; null if no action. */
  threadId: string | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function describeNotification(n: NotificationItem, i18n: I18n): NotificationView {
  switch (n.type) {
    case "thread_assigned": {
      const by = str(n.params["assignedByName"]) ?? str(n.params["assignedByEmail"]);
      const subject = str(n.params["subject"]);
      const threadId = str(n.params["threadId"]);
      const title = by
        ? i18n._(msg`${by} assigned you a thread`)
        : i18n._(msg`You were assigned a thread`);
      return { title, body: subject, threadId };
    }
    default:
      return { title: i18n._(msg`New notification`), body: null, threadId: null };
  }
}
