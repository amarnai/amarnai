import { msg } from "@lingui/core/macro";
import type { I18n } from "@lingui/core";
import { interpretNotification, type NotificationItem } from "@amarnai/api-client";

// A notification rendered for display: a one-line title, an optional collapsible
// body (present only for types that carry detail), and an optional action target
// (a thread to open). The type + param plumbing lives in the shared
// `interpretNotification`; this only maps the descriptor to localized copy, so
// the Lingui catalog stays per-app. Mirrors the mobile/extension renderers.
export type NotificationView = {
  title: string;
  /** Collapsible detail line; null when the type has no body. */
  body: string | null;
  /** Thread to open when the row's action button is used; null if no action. */
  threadId: string | null;
  /** External URL to open on click (e.g. an extension store listing); null if
   *  none. Mutually exclusive with `threadId` in practice. */
  href: string | null;
};

// Chrome Web Store / AMO listing for the browser extension. Config-gated
// (mirrors the mobile AppDownloadBanner's NEXT_PUBLIC_PLAY_STORE_URL): when
// unset — self-host without a published listing — the nudge stays informational
// with no click target.
const EXTENSION_STORE_URL = process.env.NEXT_PUBLIC_EXTENSION_STORE_URL ?? null;

export function describeNotification(n: NotificationItem, i18n: I18n): NotificationView {
  const d = interpretNotification(n);
  switch (d.kind) {
    case "thread_assigned": {
      const title = d.assignedBy
        ? i18n._(msg`${d.assignedBy} assigned you a thread`)
        : i18n._(msg`You were assigned a thread`);
      return { title, body: d.subject, threadId: d.threadId, href: null };
    }
    case "extension_not_installed":
      return {
        title: i18n._(msg`Install the Amarnai browser extension`),
        body: i18n._(msg`Triage your inbox from a side panel next to Gmail.`),
        threadId: null,
        href: EXTENSION_STORE_URL,
      };
    default:
      return { title: i18n._(msg`New notification`), body: null, threadId: null, href: null };
  }
}
