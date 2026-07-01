import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

/**
 * Theme registry — the single place a theme is declared.
 *
 * Adding a future theme (e.g. "high-contrast", "sepia") is two edits and
 * nothing else:
 *   1. append an entry to THEMES below;
 *   2. add a matching `html[data-theme="<id>"] { … }` block to each app's
 *      globals.css, re-declaring the full var contract.
 *
 * The provider, toggle, and init script are all driven off this list, so no
 * component code changes when the set of themes grows.
 */

export const STORAGE_KEY = "amarnai-theme";

export type ThemeId = string;
/** What the user picked: "system" (follow the OS) or a concrete theme id. */
export type ThemePreference = "system" | ThemeId;

export interface ThemeMeta {
  id: ThemeId;
  /** Localized display label for the toggle (extracted from packages/ui). */
  labelMsg: MessageDescriptor;
  /** The default theme, held by `:root` with no `[data-theme]` block needed. */
  isDefault?: boolean;
  /**
   * Which OS `prefers-color-scheme` value selects this theme under the
   * "system" preference. Themes without a role are manual-only (the OS never
   * auto-selects them).
   */
  systemRole?: "light" | "dark";
}

export const THEMES: ThemeMeta[] = [
  { id: "light", labelMsg: msg`Light`, isDefault: true, systemRole: "light" },
  { id: "dark", labelMsg: msg`Dark`, systemRole: "dark" },
];

export const DEFAULT_THEME_ID: ThemeId =
  THEMES.find((t) => t.isDefault)?.id ?? THEMES[0]!.id;

export function isValidThemeId(x: unknown): x is ThemeId {
  return typeof x === "string" && THEMES.some((t) => t.id === x);
}

export function isThemePreference(x: unknown): x is ThemePreference {
  return x === "system" || isValidThemeId(x);
}

/** Resolve a stored preference to a concrete theme id to apply. */
export function resolvePreference(
  pref: ThemePreference,
  systemPrefersDark: boolean,
): ThemeId {
  if (pref !== "system" && isValidThemeId(pref)) return pref;
  const role = systemPrefersDark ? "dark" : "light";
  return THEMES.find((t) => t.systemRole === role)?.id ?? DEFAULT_THEME_ID;
}
