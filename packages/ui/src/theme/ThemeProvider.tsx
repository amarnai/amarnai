"use client";

import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  STORAGE_KEY,
  THEMES,
  DEFAULT_THEME_ID,
  isThemePreference,
  resolvePreference,
  type ThemeId,
  type ThemeMeta,
  type ThemePreference,
} from "./themes.js";

export interface ThemeContextValue {
  /** The user's stored choice: "system" or a concrete theme id. */
  preference: ThemePreference;
  /** The concrete theme id currently applied to <html data-theme>. */
  resolved: ThemeId;
  /** The theme registry, for rendering a toggle. */
  themes: ThemeMeta[];
  setPreference: (pref: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    // Storage disabled (private mode); fall back to following the system.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR and the first client render must agree, so we start from the neutral
  // default. The pre-hydration script has already set the real `data-theme`,
  // so there is no flash; the mount effect below re-syncs React state from
  // storage. `suppressHydrationWarning` on <html> covers the attribute.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<ThemeId>(DEFAULT_THEME_ID);

  const apply = useCallback((pref: ThemePreference) => {
    const id = resolvePreference(pref, systemPrefersDark());
    setResolved(id);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = id;
    }
  }, []);

  // Adopt the stored preference once mounted.
  useEffect(() => {
    const stored = readStoredPreference();
    setPreferenceState(stored);
    apply(stored);
  }, [apply]);

  // While following the system, react to OS theme changes live.
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference, apply]);

  const setPreference = useCallback(
    (pref: ThemePreference) => {
      setPreferenceState(pref);
      try {
        localStorage.setItem(STORAGE_KEY, pref);
      } catch {
        // Storage disabled; the choice lasts for this session only.
      }
      apply(pref);
    },
    [apply],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, themes: THEMES, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
