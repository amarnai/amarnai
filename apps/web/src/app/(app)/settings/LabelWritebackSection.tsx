"use client";

import { useState, useTransition } from "react";
import { Trans } from "@lingui/react/macro";
import { Switch } from "@amarnai/ui";
import { api, type MailProvider } from "@/lib/api";

type Props = {
  workspaceId: string;
  provider: MailProvider;
  initialEnabled: boolean;
  // Whether the connected mailbox holds the write scope. The scope is requested
  // upfront at connect, so this is false only for pre-feature connections or
  // when the user unchecked the permission on Google's granular-consent screen.
  hasWriteScope: boolean;
  // True right after a successful consent upgrade (?writeback=enabled).
  justEnabled: boolean;
};

/**
 * Folder→label writeback control. ON by default: the write scope is granted in
 * bulk at connect, so most workspaces show this active from day one and can
 * switch it off. Without the scope the setting is inert, so the switch shows
 * OFF and turning it on routes through incremental consent first.
 */
export function LabelWritebackSection({
  workspaceId,
  provider,
  initialEnabled,
  hasWriteScope,
  justEnabled,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const isOutlook = provider === "OUTLOOK";
  const connectPath = isOutlook ? "outlook" : "gmail";

  // What the user actually gets: the stored setting only takes effect once the
  // write scope exists. A default-on setting with no scope renders as OFF.
  const effectiveEnabled = enabled && hasWriteScope;

  function handleToggle(next: boolean) {
    setError(false);

    // Turning on without the write scope: route through incremental consent.
    // The OAuth callback stores the widened grant, enables the setting, and
    // returns to ?writeback=enabled.
    if (next && !hasWriteScope) {
      window.location.href = `/api/${connectPath}/connect?workspaceId=${workspaceId}&intent=writeback`;
      return;
    }

    setEnabled(next);
    startTransition(async () => {
      try {
        const updated = await api.updateGmailSyncSettings(workspaceId, {
          labelWritebackEnabled: next,
        });
        setEnabled(updated.labelWritebackEnabled);
      } catch {
        setEnabled(!next);
        setError(true);
      }
    });
  }

  return (
    <div className="settings-subsection">
      <h3>
        {isOutlook ? <Trans>Categories in Outlook</Trans> : <Trans>Labels in Gmail</Trans>}
      </h3>
      <p className="settings-hint">
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

      <label className="settings-toggle">
        <Switch
          checked={effectiveEnabled}
          onChange={handleToggle}
          disabled={isPending}
        />
        {isOutlook ? (
          <Trans>Write sorted folders as Outlook categories</Trans>
        ) : (
          <Trans>Write sorted folders as Gmail labels</Trans>
        )}
      </label>

      {!hasWriteScope && (
        <p className="settings-hint">
          <Trans>Turning this on will ask for permission to manage your labels.</Trans>
        </p>
      )}

      {justEnabled && (
        <p className="settings-hint" style={{ color: "var(--success-ink, green)" }}>
          <Trans>Writeback is on. Your folders are being mirrored into your mailbox.</Trans>
        </p>
      )}

      {error && (
        <p className="settings-hint">
          <Trans>Could not update the setting. Please try again.</Trans>
        </p>
      )}
    </div>
  );
}
