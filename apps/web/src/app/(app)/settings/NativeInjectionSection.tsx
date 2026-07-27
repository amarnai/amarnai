"use client";

import { useState, useTransition } from "react";
import { Trans } from "@lingui/react/macro";
import { Switch } from "@amarnai/ui";
import { api } from "@/lib/api";

type Props = {
  workspaceId: string;
  initialSummariesEnabled: boolean;
  initialReplyButtonEnabled: boolean;
};

type Toggle = "threadSummaryInjectionEnabled" | "replyButtonInjectionEnabled";

/**
 * What Amarnai shows inside Gmail and Outlook themselves. Both are ON by default
 * (showing up in the mail client is the point of shipping the extension and the
 * add-in) and both are enforced server-side, because the extension is the half we
 * do not control: an old build must stop injecting the moment this is switched
 * off.
 *
 * Kept as two switches rather than one master: reading a summary of a thread you
 * already have open is free, while drafting a reply spends draft quota, so a
 * workspace may reasonably want one and not the other.
 */
export function NativeInjectionSection({
  workspaceId,
  initialSummariesEnabled,
  initialReplyButtonEnabled,
}: Props) {
  const [summaries, setSummaries] = useState(initialSummariesEnabled);
  const [replyButton, setReplyButton] = useState(initialReplyButtonEnabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function handleToggle(field: Toggle, next: boolean) {
    const apply = field === "threadSummaryInjectionEnabled" ? setSummaries : setReplyButton;
    apply(next);
    setError(false);
    startTransition(async () => {
      try {
        const updated = await api.updateGmailSyncSettings(workspaceId, { [field]: next });
        // Trust the server's echo rather than the optimistic value.
        setSummaries(updated.threadSummaryInjectionEnabled);
        setReplyButton(updated.replyButtonInjectionEnabled);
      } catch {
        apply(!next);
        setError(true);
      }
    });
  }

  return (
    <div className="settings-subsection">
      <h3><Trans>In Gmail and Outlook</Trans></h3>

      <label className="settings-toggle">
        <Switch
          checked={summaries}
          onChange={(next) => handleToggle("threadSummaryInjectionEnabled", next)}
          disabled={isPending}
        />
        <Trans>Show AI thread summaries in Gmail and Outlook</Trans>
      </label>

      <label className="settings-toggle">
        <Switch
          checked={replyButton}
          onChange={(next) => handleToggle("replyButtonInjectionEnabled", next)}
          disabled={isPending}
        />
        <Trans>Show the Amarnai Reply button for drafting replies</Trans>
      </label>

      {error && (
        <p className="settings-hint">
          <Trans>Could not update the setting. Please try again.</Trans>
        </p>
      )}
    </div>
  );
}
