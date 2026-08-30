"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import type { ApiClient } from "@aziru/api-client";
import {
  SUPPORTED_LOCALES,
  LOCALE_DISPLAY_NAMES,
  isSupportedLocale,
  type SupportedLocale,
} from "@aziru/i18n";
import "./settings.css";

export type WorkspaceLanguageSectionProps = {
  api: ApiClient;
  workspaceId: string;
  currentLocale: string;
  /**
   * The workspace language changed. The host is responsible for making the new
   * locale take effect: the web app writes its locale cookie and re-runs the
   * request through the proxy, the panel re-pulls workspaces so its provider
   * re-activates.
   */
  onChanged?: (locale: SupportedLocale) => void | Promise<void>;
};

export function WorkspaceLanguageSection({
  api,
  workspaceId,
  currentLocale,
  onChanged,
}: WorkspaceLanguageSectionProps) {
  const initial: SupportedLocale = isSupportedLocale(currentLocale) ? currentLocale : "en";
  const [selected, setSelected] = useState<SupportedLocale>(initial);
  const [pending, setPending] = useState(false);

  async function changeLocale(next: SupportedLocale) {
    setSelected(next);
    setPending(true);
    try {
      await api.updateWorkspace(workspaceId, { locale: next });
      await onChanged?.(next);
    } catch {
      // Put the picker back where it was: nothing was saved.
      setSelected(initial);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="st-section">
      <h2 className="st-title">
        <Trans>Language</Trans>
      </h2>
      <div className="st-field">
        <select
          id="st-ws-locale"
          className="st-select"
          value={selected}
          disabled={pending}
          aria-label={LOCALE_DISPLAY_NAMES[selected]}
          onChange={(e) => {
            const val = e.target.value;
            if (isSupportedLocale(val)) void changeLocale(val);
          }}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_DISPLAY_NAMES[l]}
            </option>
          ))}
        </select>
        <p className="st-hint">
          <Trans>
            Sets the language for this workspace, including the interface and AI-generated
            folders.
          </Trans>
        </p>
      </div>
    </section>
  );
}
