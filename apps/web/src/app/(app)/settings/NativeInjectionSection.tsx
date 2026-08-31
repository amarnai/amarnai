"use client";

import { useState, useTransition } from "react";
import { Trans } from "@lingui/react/macro";
import { Switch } from "@aziru/ui";
import { api } from "@/lib/api";

type Props = {
  workspaceId: string;
  initialSummariesEnabled: boolean;
  initialReplyButtonEnabled: boolean;
  initialPanelEnabled: boolean;
};

type Toggle =
  | "threadSummaryInjectionEnabled"
  | "replyButtonInjectionEnabled"
  | "injectedPanelEnabled";

/**
 * What Aziru shows inside Gmail and Outlook themselves. All three are ON by
 * default (showing up in the mail client is the point of shipping the extension
 * and the add-in) and all three are enforced server-side, because the extension
 * is the half we do not control: an old build must stop injecting the moment
 * this is switched off.
 *
 * Kept as separate switches rather than one master: reading a summary of a
 * thread you already have open is free, drafting a reply spends draft quota, and
 * the panel is the only one of the three that can change how a thread is sorted.
 * A workspace may reasonably want some and not others.
 */
export function NativeInjectionSection({
  workspaceId,
  initialSummariesEnabled,
  initialReplyButtonEnabled,
  initialPanelEnabled,
}: Props) {
  const [summaries, setSummaries] = useState(initialSummariesEnabled);
  const [replyButton, setReplyButton] = useState(initialReplyButtonEnabled);
  const [panel, setPanel] = useState(initialPanelEnabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const setters: Record<Toggle, (next: boolean) => void> = {
    threadSummaryInjectionEnabled: setSummaries,
    replyButtonInjectionEnabled: setReplyButton,
    injectedPanelEnabled: setPanel,
  };

  function handleToggle(field: Toggle, next: boolean) {
    const apply = setters[field];
    apply(next);
    setError(false);
    startTransition(async () => {
      try {
        const updated = await api.updateGmailSyncSettings(workspaceId, { [field]: next });
        // Trust the server's echo rather than the optimistic value.
        setSummaries(updated.threadSummaryInjectionEnabled);
        setReplyButton(updated.replyButtonInjectionEnabled);
        setPanel(updated.injectedPanelEnabled);
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
          checked={panel}
          onChange={(next) => handleToggle("injectedPanelEnabled", next)}
          disabled={isPending}
        />
        <Trans>Show the Aziru panel next to the thread you are reading</Trans>
      </label>

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
        <Trans>Show the Aziru Reply button for drafting replies</Trans>
      </label>

      {error && (
        <p className="settings-hint">
          <Trans>Could not update the setting. Please try again.</Trans>
        </p>
      )}
    </div>
  );
}
