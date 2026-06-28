"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWorkspaceLocaleAction } from "@/actions/workspace";
import { Trans } from "@lingui/react/macro";
import {
  SUPPORTED_LOCALES,
  LOCALE_DISPLAY_NAMES,
  isSupportedLocale,
  type SupportedLocale,
} from "@amarnai/i18n";

export function WorkspaceLanguageSection({ currentLocale }: { currentLocale: string }) {
  const router = useRouter();
  const initial: SupportedLocale = isSupportedLocale(currentLocale) ? currentLocale : "en";
  const [selected, setSelected] = useState<SupportedLocale>(initial);
  const [pending, startTransition] = useTransition();

  function changeLocale(next: SupportedLocale) {
    setSelected(next);
    startTransition(async () => {
      const result = await setWorkspaceLocaleAction(next);
      if (result?.error) {
        setSelected(initial);
        return;
      }
      // The action wrote the locale cookie; re-run the request through middleware
      // so the new locale resolves and both server- and client-rendered strings
      // update without a manual refresh.
      router.refresh();
    });
  }

  return (
    <section className="settings-section">
      <h2><Trans>Language</Trans></h2>
      <div className="form-group">
        <select
          id="ws-locale"
          className="form-input"
          value={selected}
          disabled={pending}
          onChange={(e) => {
            const val = e.target.value;
            if (isSupportedLocale(val)) changeLocale(val);
          }}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_DISPLAY_NAMES[l]}
            </option>
          ))}
        </select>
        <p className="settings-hint">
          <Trans>Sets the language for this workspace, including the interface and AI-generated folders.</Trans>
        </p>
      </div>
    </section>
  );
}
