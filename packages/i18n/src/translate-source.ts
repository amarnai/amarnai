import type { I18n } from "@lingui/core";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";

/**
 * Translate a plain English source string against the active catalog.
 *
 * Compiled Lingui catalogs are keyed by a hash of the message (Lingui's default
 * id strategy), NOT by the raw English text — so `i18n._("Clients")` would miss
 * and fall through to English. The `<Trans>`/`msg` macros hash at build time;
 * for strings only known at runtime (e.g. taxonomy template/folder names) we
 * hash here with the same function so the lookup hits. Falls back to `source`
 * when the message is absent (untranslated locale, source locale, or unknown).
 */
export function translateSource(
  i18n: I18n,
  source: string,
  values?: Record<string, unknown>,
): string {
  return i18n._(generateMessageId(source), values, { message: source });
}
