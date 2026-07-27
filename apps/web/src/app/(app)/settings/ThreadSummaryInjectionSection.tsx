"use client";

import { useState, useTransition } from "react";
import { Trans } from "@lingui/react/macro";
import { Switch } from "@amarnai/ui";
import { api } from "@/lib/api";

type Props = {
  workspaceId: string;
  initialEnabled: boolean;
};

/**
 * Browser-extension thread-summary card in Gmail/Outlook. ON by default (the
 * point of shipping the content scripts); the extension itself has no toggle,
 * so this workspace setting is the only way to turn it off.
 */
export function ThreadSummaryInjectionSection({ workspaceId, initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function handleToggle(next: boolean) {
    setEnabled(next);
    setError(false);
    startTransition(async () => {
      try {
        const updated = await api.updateGmailSyncSettings(workspaceId, {
          threadSummaryInjectionEnabled: next,
        });
        setEnabled(updated.threadSummaryInjectionEnabled);
      } catch {
        setEnabled(!next);
        setError(true);
      }
    });
  }

  return (
    <div className="settings-subsection">
      <h3><Trans>Browser extension</Trans></h3>
      <label className="settings-toggle">
        <Switch checked={enabled} onChange={handleToggle} disabled={isPending} />
        <Trans>Show AI thread summaries in Gmail and Outlook</Trans>
      </label>

      {error && (
        <p className="settings-hint">
          <Trans>Could not update the setting. Please try again.</Trans>
        </p>
      )}
    </div>
  );
}
