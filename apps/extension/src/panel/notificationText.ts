import { msg } from "@lingui/core/macro";
import type { I18n } from "@lingui/core";
import { interpretNotification, type NotificationItem } from "@amarnai/api-client";

// Maps a notification's type + params to a localized one-line title. The type +
// param plumbing lives in the shared `interpretNotification`; this only maps the
// descriptor to localized copy, so the Lingui catalog stays per-app. The side
// panel's pop-up is title-only (like the web bell), so the subject is not
// inlined here — it surfaces on the web app's full notifications page.
export function notificationTitle(n: NotificationItem, i18n: I18n): string {
  const d = interpretNotification(n);
  switch (d.kind) {
    case "thread_assigned":
      return d.assignedBy
        ? i18n._(msg`${d.assignedBy} assigned you a thread`)
        : i18n._(msg`You were assigned a thread`);
    case "comment_mention":
      return d.mentionedBy
        ? i18n._(msg`${d.mentionedBy} mentioned you in a comment`)
        : i18n._(msg`You were mentioned in a comment`);
    case "gmail_disconnected":
      return i18n._(msg`Gmail disconnected`);
    case "backfill_complete":
      return i18n._(msg`Inbox import complete`);
    case "quota_blocked":
      return i18n._(msg`Monthly sorting limit reached`);
    default:
      return i18n._(msg`New notification`);
  }
}
