"use client";

import { useState, useTransition } from "react";
import { api, type GmailSyncSettings } from "@/lib/api";
import { sweepInboxAction } from "@/actions/gmail";

type Props = {
  workspaceId: string;
  initialSettings: GmailSyncSettings;
};

export function GmailSyncSettingsSection({ workspaceId, initialSettings }: Props) {
  const [settings, setSettings] = useState<GmailSyncSettings>(initialSettings);
  const [isPending, startTransition] = useTransition();
  const [rescanState, setRescanState] = useState<"idle" | "pending" | "done" | "error">("idle");

  const isDirty =
    settings.includeSpam !== initialSettings.includeSpam ||
    settings.includePromotions !== initialSettings.includePromotions;

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
      <h3>Sync filters</h3>
      <p className="settings-hint">
        These settings control which Gmail threads are imported. Trash is always excluded.
      </p>

      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.includeSpam}
          onChange={() => handleToggle("includeSpam")}
          disabled={isPending}
        />
        Include spam
      </label>

      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.includePromotions}
          onChange={() => handleToggle("includePromotions")}
          disabled={isPending}
        />
        Include Promotions
      </label>

      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.routeBulkToOther}
          onChange={() => handleToggle("routeBulkToOther")}
          disabled={isPending}
        />
        Auto-file notifications to Updates / Other
      </label>
      <p className="settings-hint">
        Detected notifications, newsletters, and service updates are filed to your
        catch-all folder without using AI. Requires the <strong>Updates / Other</strong> folder
        from a taxonomy template.
      </p>

      <div className="rescan-row">
        <button
          className="btn-secondary"
          onClick={handleRescan}
          disabled={isPending || rescanState === "pending" || !isDirty}
          type="button"
        >
          {rescanState === "pending" ? "Queuing rescan…" : "Rescan inbox"}
        </button>
        {rescanState === "done" && (
          <span className="rescan-feedback rescan-feedback-ok">
            Rescan queued — threads will update shortly.
          </span>
        )}
        {rescanState === "error" && (
          <span className="rescan-feedback rescan-feedback-error">
            Could not queue rescan. Please try again.
          </span>
        )}
      </div>

      <p className="settings-hint">
        Use "Rescan inbox" after changing filter settings to apply them to threads already in your inbox.
      </p>
    </div>
  );
}
