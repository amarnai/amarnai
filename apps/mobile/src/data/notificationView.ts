import { msg } from '@lingui/core/macro';
import type { I18n } from '@lingui/core';
import { interpretNotification, type NotificationItem } from '@amarnai/api-client';

// A notification rendered for display: a one-line title, an optional collapsible
// body, and an optional action target (a thread to open). The type + param
// plumbing lives in the shared `interpretNotification`; this only maps the
// descriptor to localized copy, so the Lingui catalog stays per-app. Mirrors the
// web/extension renderers.
export type NotificationView = {
  title: string;
  /** Collapsible detail line; null when the type has no body. */
  body: string | null;
  /** Thread to open when the row's action is used; null if no action. */
  threadId: string | null;
};

export function describeNotification(n: NotificationItem, i18n: I18n): NotificationView {
  const d = interpretNotification(n);
  switch (d.kind) {
    case 'thread_assigned': {
      const title = d.assignedBy
        ? i18n._(msg`${d.assignedBy} assigned you a thread`)
        : i18n._(msg`You were assigned a thread`);
      return { title, body: d.subject, threadId: d.threadId };
    }
    default:
      return { title: i18n._(msg`New notification`), body: null, threadId: null };
  }
}
