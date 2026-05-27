"use client";

import { useState, useTransition } from "react";
import type { GmailSyncSettings } from "@/lib/api";
import { sweepInboxAction } from "@/actions/gmail";

const API_BASE =
  typeof window !== "undefined"
    ? (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001")
    : "http://localhost:3001";

type Props = {
  workspaceId: string;
  initialSettings: GmailSyncSettings;
};

export function GmailSyncSettingsSection({ workspaceId, initialSettings }: Props) {
  const [settings, setSettings] = useState<GmailSyncSettings>(initialSettings);
  const [isPending, startTransition] = useTransition();
  const [rescanState, setRescanState] = useState<"idle" | "pending" | "done" | "error">("idle");

  function handleToggle(field: keyof GmailSyncSettings) {
    const newValue = !settings[field];
    // Optimistic update
    setSettings((prev) => ({ ...prev, [field]: newValue }));

    startTransition(async () => {
      try {
        const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/gmail-sync-settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: newValue }),
        });
        if (!res.ok) throw new Error(`PATCH returned ${res.status}`);
        const updated = (await res.json()) as GmailSyncSettings;
        setSettings(updated);
      } catch {
        // Revert on error
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
    <section className="settings-section">
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

      <div className="rescan-row">
        <button
          className="btn-secondary"
          onClick={handleRescan}
          disabled={isPending || rescanState === "pending"}
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
    </section>
  );
}
