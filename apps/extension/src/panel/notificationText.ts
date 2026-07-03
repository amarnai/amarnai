import { msg } from "@lingui/core/macro";
import type { I18n } from "@lingui/core";
import type { NotificationItem } from "@amarnai/api-client";

// Maps a notification's type + params to a localized one-line title. Mirrors the
// web/mobile renderers; kept per-platform because the Lingui catalogs differ.
// Add a case per producer; unknown types get a neutral fallback.
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function notificationTitle(n: NotificationItem, i18n: I18n): string {
  switch (n.type) {
    case "thread_assigned": {
      const by = str(n.params["assignedByName"]) ?? str(n.params["assignedByEmail"]);
      const subject = str(n.params["subject"]);
      if (by && subject) return i18n._(msg`${by} assigned you: ${subject}`);
      if (by) return i18n._(msg`${by} assigned you a thread`);
      return i18n._(msg`You were assigned a thread`);
    }
    default:
      return i18n._(msg`New notification`);
  }
}
