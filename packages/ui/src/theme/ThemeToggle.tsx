"use client";

import React from "react";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { useTheme } from "./useTheme.js";

export interface ThemeToggleProps {
  /** Extra class on the button, e.g. `theme-toggle--nav` for the header. */
  className?: string;
}

/**
 * Animated sun/moon theme switch. Shows the current theme's icon and, on click,
 * advances to the next theme in the registry — a light/dark toggle for the two
 * shipped themes. Setting an explicit preference stops following the OS.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { i18n } = useLingui();
  const { resolved, themes, setPreference } = useTheme();

  const idx = themes.findIndex((t) => t.id === resolved);
  const next = themes[(idx + 1) % themes.length] ?? themes[0]!;

  return (
    <button
      type="button"
      className={className ? `theme-toggle ${className}` : "theme-toggle"}
      data-resolved={resolved}
      onClick={() => setPreference(next.id)}
      aria-label={i18n._(msg`Switch theme`)}
      title={i18n._(msg`Switch theme`)}
    >
      <svg
        className="theme-toggle-sun"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
      </svg>
      <svg
        className="theme-toggle-moon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
