"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import type { ApiClient, MailProvider } from "@aziru/api-client";
import { Switch } from "../Switch.js";
import "./settings.css";

export type LabelWritebackSectionProps = {
  api: ApiClient;
  workspaceId: string;
  provider: MailProvider;
  initialEnabled: boolean;
  /**
   * Whether the connected mailbox holds the write scope. The scope is requested
   * upfront at connect, so this is false only for pre-feature connections or
   * when the user unchecked the permission on Google's granular-consent screen.
   */
  hasWriteScope: boolean;
  /** True right after a successful consent upgrade. */
  justEnabled?: boolean;
  /**
   * Ask for the write permission. Host-specific: the web app redirects into its
   * own incremental-consent route; the panel has no such route and sends the
   * user to the web settings page instead.
   */
  onRequestWriteScope: () => void;
};

/**
 * Folder to label/category writeback. ON by default: the write scope is granted
 * in bulk at connect, so most workspaces show this active from day one and can
 * switch it off. Without the scope the setting is inert, so the switch shows OFF
 * and turning it on asks for permission first.
 */
export function LabelWritebackSection({
  api,
  workspaceId,
  provider,
  initialEnabled,
  hasWriteScope,
  justEnabled = false,
  onRequestWriteScope,
}: LabelWritebackSectionProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const isOutlook = provider === "OUTLOOK";

  // What the user actually gets: the stored setting only takes effect once the
  // write scope exists. A default-on setting with no scope renders as OFF.
  const effectiveEnabled = enabled && hasWriteScope;

  async function handleToggle(next: boolean) {
    setError(false);

    // Turning on without the write scope: ask for permission first. The grant
    // flow enables the setting on the way back, so nothing is written here.
    if (next && !hasWriteScope) {
      onRequestWriteScope();
      return;
    }

    setEnabled(next);
    setPending(true);
    try {
      const updated = await api.updateGmailSyncSettings(workspaceId, {
        labelWritebackEnabled: next,
      });
      setEnabled(updated.labelWritebackEnabled);
    } catch {
      setEnabled(!next);
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="st-subsection">
      <h3 className="st-subtitle">
        {isOutlook ? <Trans>Categories in Outlook</Trans> : <Trans>Labels in Gmail</Trans>}
      </h3>
      <p className="st-hint">
        {isOutlook ? (
          <Trans>
            Your folders are mirrored as Outlook categories and kept in sync as threads are
            sorted. Amarnai only manages categories under the <strong>Amarnai</strong> namespace
            and never sends, deletes, or moves your mail.
          </Trans>
        ) : (
          <Trans>
            Your folders are mirrored as Gmail labels and kept in sync as threads are sorted.
            Amarnai only manages labels under the <strong>Amarnai/</strong> namespace and never
            sends, deletes, or moves your mail.
          </Trans>
        )}
      </p>

      <label className="st-toggle">
        <Switch
          checked={effectiveEnabled}
          onChange={(next) => void handleToggle(next)}
          disabled={pending}
        />
        {isOutlook ? (
          <Trans>Write sorted folders as Outlook categories</Trans>
        ) : (
          <Trans>Write sorted folders as Gmail labels</Trans>
        )}
      </label>

      {!hasWriteScope && (
        <p className="st-hint">
          <Trans>Turning this on will ask for permission to manage your labels.</Trans>
        </p>
      )}

      {justEnabled && (
        <p className="st-ok">
          <Trans>Writeback is on. Your folders are being mirrored into your mailbox.</Trans>
        </p>
      )}

      {error && (
        <p className="st-error" role="alert">
          <Trans>Could not update the setting. Please try again.</Trans>
        </p>
      )}
    </div>
  );
}
