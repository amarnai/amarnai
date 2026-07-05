import { msg, plural } from '@lingui/core/macro';
import type { I18n } from '@lingui/core';
import { interpretNotification, type NotificationItem } from '@amarnai/api-client';

// What tapping a notification does. A discriminated union rather than a bag of
// nullable fields so each type declares exactly one action, and the screen
// dispatches on `kind`. Mirrors the web renderer (minus the desktop-only
// external-link action).
export type NotificationAction =
  // Open a thread in its workspace.
  | { kind: 'open_thread'; threadId: string }
  // Navigate to an in-app tab in the notification's workspace.
  | { kind: 'navigate'; path: '/(app)/(tabs)/emails' | '/(app)/(tabs)/plan' }
  // Start the native Gmail reconnect flow for the notification's workspace.
  | { kind: 'reconnect_gmail' };

// A notification rendered for display: a one-line title, an optional collapsible
// body, and an optional tap action. The type + param plumbing lives in the shared
// `interpretNotification`; this only maps the descriptor to localized copy, so
// the Lingui catalog stays per-app. Mirrors the web/extension renderers.
export type NotificationView = {
  title: string;
  /** Collapsible detail line; null when the type has no body. */
  body: string | null;
  /** What tapping the row does; null if the row has no action. */
  action: NotificationAction | null;
};

export function describeNotification(n: NotificationItem, i18n: I18n): NotificationView {
  const d = interpretNotification(n);
  switch (d.kind) {
    case 'thread_assigned': {
      const title = d.assignedBy
        ? i18n._(msg`${d.assignedBy} assigned you a thread`)
        : i18n._(msg`You were assigned a thread`);
      return {
        title,
        body: d.subject,
        action: d.threadId ? { kind: 'open_thread', threadId: d.threadId } : null,
      };
    }
    case 'extension_not_installed':
      // Rendered informationally on mobile (no action): the browser extension is
      // a desktop surface. Kept in the feed rather than filtered so the
      // server-driven unread badge still clears when the row is read/dismissed.
      return {
        title: i18n._(msg`Install the Amarnai browser extension`),
        body: i18n._(msg`Save time by triaging your inbox without leaving Gmail. The extension runs in your desktop browser.`),
        action: null,
      };
    case 'gmail_disconnected':
      return {
        title: i18n._(msg`Gmail disconnected`),
        body: d.gmailAddress
          ? i18n._(msg`Amarnai lost access to ${d.gmailAddress}. Tap to reconnect your Google account.`)
          : i18n._(msg`Amarnai lost access to your inbox. Tap to reconnect your Google account.`),
        action: { kind: 'reconnect_gmail' },
      };
    case 'backfill_complete':
      return {
        title: i18n._(msg`Inbox import complete`),
        body:
          d.processed === null
            ? i18n._(msg`Your inbox import finished.`)
            : d.capReached
              ? i18n._(
                  msg`${plural(d.processed, {
                    one: '# thread imported.',
                    other: '# threads imported.',
                  })} Your plan's import limit was reached.`,
                )
              : i18n._(
                  msg`${plural(d.processed, {
                    one: '# thread imported.',
                    other: '# threads imported.',
                  })}`,
                ),
        action: { kind: 'navigate', path: '/(app)/(tabs)/emails' },
      };
    case 'quota_blocked':
      // BUSINESS is the top tier: nothing to upgrade to, so the notice is
      // informational. Any other (or unknown) plan gets the upgrade CTA.
      return d.plan === 'BUSINESS'
        ? {
            title: i18n._(msg`Monthly sorting limit reached`),
            body: i18n._(msg`New emails will wait until your limit resets next month.`),
            action: null,
          }
        : {
            title: i18n._(msg`Monthly sorting limit reached`),
            body: i18n._(msg`New emails will wait until next month. Upgrade your plan for a higher limit.`),
            action: { kind: 'navigate', path: '/(app)/(tabs)/plan' },
          };
    default:
      return { title: i18n._(msg`New notification`), body: null, action: null };
  }
}
