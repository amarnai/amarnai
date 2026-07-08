import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * Localized "Open in <provider>" label for the thread deep-link control (tooltip,
 * aria-label, title). Single source for the provider ternary that was repeated
 * across ThreadRow, both ThreadPreviews, and the extension preview pane. Uses the
 * same source strings as before, so it reuses the existing catalog keys.
 */
export function openInProviderLabel(i18n: I18n, provider: string): string {
  return i18n._(provider === "OUTLOOK" ? msg`Open in Outlook` : msg`Open in Gmail`);
}
