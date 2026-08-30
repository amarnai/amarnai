"use client";

import { Trans } from "@lingui/react/macro";
import { ThemeToggle } from "@aziru/ui";

/**
 * Compact appearance control: a label and the sun/moon toggle on one row. The
 * theme is persisted per-device in localStorage by the shared ThemeProvider.
 */
export function AppearanceSection() {
  return (
    <section className="settings-section">
      <div className="settings-inline-row">
        <h2><Trans>Appearance</Trans></h2>
        <ThemeToggle />
      </div>
    </section>
  );
}
