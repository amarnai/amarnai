"use client";

import { useState, useTransition } from "react";
import { Trans } from "@lingui/react/macro";
import { api, type GmailSyncSettings, type MailProvider } from "@/lib/api";
import { sweepInboxAction } from "@/actions/gmail";

type Props = {
  workspaceId: string;
  provider: MailProvider;
  initialSettings: GmailSyncSettings;
};

export function GmailSyncSettingsSection({ workspaceId, provider, initialSettings }: Props) {
  const [settings, setSettings] = useState<GmailSyncSettings>(initialSettings);
  const [isPending, startTransition] = useTransition();
  const [rescanState, setRescanState] = useState<"idle" | "pending" | "done" | "error">("idle");

  // Promotions is a Gmail-category concept with no Outlook equivalent, so the
  // toggle is hidden for Outlook and excluded from the dirty check.
  const showPromotions = provider !== "OUTLOOK";
  const isDirty =
    settings.includeSpam !== initialSettings.includeSpam ||
    (showPromotions && settings.includePromotions !== initialSettings.includePromotions);

  function handleToggle(field: "includeSpam" | "includePromotions" | "routeBulkToOther") {
    const newValue = !settings[field];
    setSettings((prev) => ({ ...prev, [field]: newValue }));

    startTransition(async () => {
      try {
        const updated = await api.updateGmailSyncSettings(workspaceId, { [field]: newValue });
        setSettings(updated);
      } catch {
        setSettings((prev) => ({ ...prev, [field]: !newValue }));
      }
    });
  }

  function handleRescan() {
    setRescanState("pending");
    startTransition(async () => {
      try {
        await sweepInboxAction(workspaceId);
        setRescanState("done");
      } catch {
        setRescanState("error");
      }
    });
  }

  return (
    <div className="settings-subsection">
      <h3><Trans>Sync filters</Trans></h3>
      <p className="settings-hint">
        <Trans>These settings control which inbox threads are imported. Trash is always excluded.</Trans>
      </p>

      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.includeSpam}
          onChange={() => handleToggle("includeSpam")}
          disabled={isPending}
        />
        <Trans>Include spam</Trans>
      </label>

      {showPromotions && (
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.includePromotions}
            onChange={() => handleToggle("includePromotions")}
            disabled={isPending}
          />
          <Trans>Include Promotions</Trans>
        </label>
      )}

      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.routeBulkToOther}
          onChange={() => handleToggle("routeBulkToOther")}
          disabled={isPending}
        />
        <Trans>Auto-file notifications to Updates / Other</Trans>
      </label>
      <p className="settings-hint">
        <Trans>
          Detected notifications, newsletters, and service updates are filed to your
          catch-all folder without using AI. Requires the <strong>Updates / Other</strong> folder
          from a taxonomy template.
        </Trans>
      </p>

      <div className="rescan-row">
        <button
          className="btn-secondary"
          onClick={handleRescan}
          disabled={isPending || rescanState === "pending" || !isDirty}
          type="button"
        >
          {rescanState === "pending" ? <Trans>Queuing rescan…</Trans> : <Trans>Rescan inbox</Trans>}
        </button>
        {rescanState === "done" && (
          <span className="rescan-feedback rescan-feedback-ok">
            <Trans>Rescan queued: threads will update shortly.</Trans>
          </span>
        )}
        {rescanState === "error" && (
          <span className="rescan-feedback rescan-feedback-error">
            <Trans>Could not queue rescan. Please try again.</Trans>
          </span>
        )}
      </div>

      <p className="settings-hint">
        <Trans>Use &quot;Rescan inbox&quot; after changing filter settings to apply them to threads already in your inbox.</Trans>
      </p>
    </div>
  );
}
