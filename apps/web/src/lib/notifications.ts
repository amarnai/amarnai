import { msg, plural } from "@lingui/core/macro";
import type { I18n } from "@lingui/core";
import { interpretNotification, type NotificationItem } from "@amarnai/api-client";
import { CHROME_EXTENSION_STORE_URL } from "@amarnai/ui";

// What clicking a notification does. A discriminated union rather than a bag of
// nullable fields so each type declares exactly one action, and the surface
// dispatches on `kind` (see runNotificationAction). Kept surface-agnostic here —
// the concrete URLs/navigation live in the runner.
export type NotificationAction =
  // Open a thread in its workspace (workspace-aware navigation).
  | { kind: "open_thread"; threadId: string }
  // Open an external URL in a new tab (e.g. an extension store listing).
  | { kind: "open_url"; href: string }
  // Navigate to an in-app route in the notification's workspace.
  | { kind: "navigate"; path: "/emails" | "/upgrade" }
  // Start the Gmail OAuth reconnect flow for the notification's workspace.
  | { kind: "reconnect_gmail" };

// A notification rendered for display: a one-line title, an optional collapsible
// body (present only for types that carry detail), and an optional click action.
// The type + param plumbing lives in the shared `interpretNotification`; this
// only maps the descriptor to localized copy, so the Lingui catalog stays
// per-app. Mirrors the mobile/extension renderers.
export type NotificationView = {
  title: string;
  /** Collapsible detail line; null when the type has no body. */
  body: string | null;
  /** What clicking the row's action button does; null if the row has no action. */
  action: NotificationAction | null;
};

// Store listings for the browser extension. The Chrome Web Store listing is
// published, so it is the fallback rather than a config requirement — without
// it the nudge shipped a dead link wherever the env var was unset. The env var
// remains an override for self-hosters shipping their own build. `|| null` on
// the Firefox one so a blank-but-set var counts as unset (AMO is unpublished).
const CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || CHROME_EXTENSION_STORE_URL;
const FIREFOX_STORE_URL = process.env.NEXT_PUBLIC_EXTENSION_STORE_URL_FIREFOX || null;

// Firefox is reliably UA-detectable; every other browser gets the Chrome Web
// Store link, which covers all Chromium-based browsers. Falls back to the
// other listing when only one is configured, so the fallback (not detection)
// decides whether a link exists — SSR and client always agree on `href`
// presence, only the target may differ after hydration.
function extensionStoreUrl(): string | null {
  const isFirefox = typeof navigator !== "undefined" && navigator.userAgent.includes("Firefox");
  return isFirefox ? (FIREFOX_STORE_URL ?? CHROME_STORE_URL) : (CHROME_STORE_URL ?? FIREFOX_STORE_URL);
}

export function describeNotification(n: NotificationItem, i18n: I18n): NotificationView {
  const d = interpretNotification(n);
  switch (d.kind) {
    case "thread_assigned": {
      const title = d.assignedBy
        ? i18n._(msg`${d.assignedBy} assigned you a thread`)
        : i18n._(msg`You were assigned a thread`);
      return {
        title,
        body: d.subject,
        action: d.threadId ? { kind: "open_thread", threadId: d.threadId } : null,
      };
    }
    case "extension_not_installed": {
      const href = extensionStoreUrl();
      return {
        title: i18n._(msg`Install the Amarnai browser extension`),
        body: i18n._(msg`Save time by triaging your inbox without leaving your email.`),
        action: href ? { kind: "open_url", href } : null,
      };
    }
    case "gmail_disconnected":
      return {
        title: i18n._(msg`Gmail disconnected`),
        body: d.gmailAddress
          ? i18n._(msg`Amarnai lost access to ${d.gmailAddress}. Click to reconnect your Google account.`)
          : i18n._(msg`Amarnai lost access to your inbox. Click to reconnect your Google account.`),
        action: { kind: "reconnect_gmail" },
      };
    case "backfill_complete":
      return {
        title: i18n._(msg`Inbox import complete`),
        body:
          d.processed === null
            ? i18n._(msg`Your inbox import finished.`)
            : d.capReached
              ? i18n._(
                  msg`${plural(d.processed, {
                    one: "# thread imported.",
                    other: "# threads imported.",
                  })} Your plan's import limit was reached.`,
                )
              : i18n._(
                  msg`${plural(d.processed, {
                    one: "# thread imported.",
                    other: "# threads imported.",
                  })}`,
                ),
        action: { kind: "navigate", path: "/emails" },
      };
    case "quota_blocked":
      // BUSINESS is the top tier: nothing to upgrade to, so the notice is
      // informational. Any other (or unknown) plan gets the upgrade CTA.
      return d.plan === "BUSINESS"
        ? {
            title: i18n._(msg`Monthly sorting limit reached`),
            body: i18n._(msg`New emails will wait until your limit resets next month.`),
            action: null,
          }
        : {
            title: i18n._(msg`Monthly sorting limit reached`),
            body: i18n._(msg`New emails will wait until next month. Upgrade your plan for a higher limit.`),
            action: { kind: "navigate", path: "/upgrade" },
          };
    default:
      return { title: i18n._(msg`New notification`), body: null, action: null };
  }
}
