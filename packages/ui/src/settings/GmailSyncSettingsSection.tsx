"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import type { ApiClient, GmailSyncSettings, MailProvider } from "@aziru/api-client";
import { Switch } from "../Switch.js";
import "./settings.css";

export type GmailSyncSettingsSectionProps = {
  api: ApiClient;
  workspaceId: string;
  provider: MailProvider;
  initialSettings: GmailSyncSettings;
};

/**
 * Which inbox threads get imported, plus the rescan that applies a changed
 * filter to mail already pulled in. Provider-agnostic despite the name.
 */
export function GmailSyncSettingsSection({
  api,
  workspaceId,
  provider,
  initialSettings,
}: GmailSyncSettingsSectionProps) {
  const [settings, setSettings] = useState<GmailSyncSettings>(initialSettings);
  const [pending, setPending] = useState(false);
  const [rescanState, setRescanState] = useState<"idle" | "pending" | "done" | "error">("idle");

  // Promotions is a Gmail-category concept with no Outlook equivalent, so the
  // toggle is hidden for Outlook and excluded from the dirty check.
  const showPromotions = provider !== "OUTLOOK";
  const isDirty =
    settings.includeSpam !== initialSettings.includeSpam ||
    (showPromotions && settings.includePromotions !== initialSettings.includePromotions);

  async function handleToggle(field: "includeSpam" | "includePromotions" | "routeBulkToOther") {
    const newValue = !settings[field];
    setSettings((prev) => ({ ...prev, [field]: newValue }));
    setPending(true);
    try {
      const updated = await api.updateGmailSyncSettings(workspaceId, { [field]: newValue });
      setSettings(updated);
    } catch {
      setSettings((prev) => ({ ...prev, [field]: !newValue }));
    } finally {
      setPending(false);
    }
  }

  async function handleRescan() {
    setRescanState("pending");
    try {
      await api.sweepInbox(workspaceId);
      setRescanState("done");
    } catch {
      setRescanState("error");
    }
  }

  return (
    <div className="st-subsection">
      <h3 className="st-subtitle">
        <Trans>Sync filters</Trans>
      </h3>
      <p className="st-hint">
        <Trans>
          These settings control which inbox threads are imported. Trash is always excluded.
        </Trans>
      </p>

      <label className="st-toggle">
        <Switch
          checked={settings.includeSpam}
          onChange={() => void handleToggle("includeSpam")}
          disabled={pending}
        />
        <Trans>Include spam</Trans>
      </label>

      {showPromotions && (
        <label className="st-toggle">
          <Switch
            checked={settings.includePromotions}
            onChange={() => void handleToggle("includePromotions")}
            disabled={pending}
          />
          <Trans>Include Promotions</Trans>
        </label>
      )}

      <label className="st-toggle">
        <Switch
          checked={settings.routeBulkToOther}
          onChange={() => void handleToggle("routeBulkToOther")}
          disabled={pending}
        />
        <Trans>Auto-file notifications to Updates / Other</Trans>
      </label>
      <p className="st-hint">
        <Trans>
          Detected notifications, newsletters, and service updates are filed to your catch-all
          folder without using AI. Requires the <strong>Updates / Other</strong> folder from a
          taxonomy template.
        </Trans>
      </p>

      <div className="st-actions">
        <button
          type="button"
          className="st-btn"
          onClick={() => void handleRescan()}
          disabled={pending || rescanState === "pending" || !isDirty}
        >
          {rescanState === "pending" ? <Trans>Queuing rescan…</Trans> : <Trans>Rescan inbox</Trans>}
        </button>
        {rescanState === "done" && (
          <span className="st-ok">
            <Trans>Rescan queued: threads will update shortly.</Trans>
          </span>
        )}
        {rescanState === "error" && (
          <span className="st-error" role="alert">
            <Trans>Could not queue rescan. Please try again.</Trans>
          </span>
        )}
      </div>

      <p className="st-hint">
        <Trans>
          Use &quot;Rescan inbox&quot; after changing filter settings to apply them to threads
          already in your inbox.
        </Trans>
      </p>
    </div>
  );
}
