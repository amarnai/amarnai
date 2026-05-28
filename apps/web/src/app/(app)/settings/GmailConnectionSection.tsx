"use client";

import { useTransition } from "react";
import { disconnectGmailAction } from "@/actions/gmail";
import type { GmailConnection, SyncStatus, GmailSyncSettings } from "@/lib/api";
import { GmailSyncSettingsSection } from "./GmailSyncSettingsSection";

const DEFAULT_SYNC_SETTINGS: GmailSyncSettings = {
  includeSpam: false,
  includePromotions: false,
  sortingPaused: false,
};

type Props = {
  workspaceId: string;
  connection: GmailConnection;
  syncStatus: SyncStatus;
  syncSettings: GmailSyncSettings | null;
  connectError: string | null;
  connectSuccess: boolean;
};

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    "Access was denied. Grant read-only Gmail access to connect.",
  invalid_callback:
    "The authorization callback was incomplete. Please try again.",
  invalid_state:
    "The authorization request expired or was tampered with. Please try again.",
  unauthorized:
    "You do not have permission to connect a Gmail inbox to this workspace.",
  token_exchange:
    "Google could not complete the authorization. The link may have expired — please try again. If the problem persists, check that the Gmail callback URL is registered in Google Cloud Console.",
  insufficient_scope:
    "Gmail read-only access was not granted. Please try again and approve the requested permission.",
  gmail_profile_fetch:
    "Could not access your Gmail inbox. Make sure the Gmail API is enabled and the gmail.readonly scope is added to the OAuth consent screen in Google Cloud Console.",
  google_account_info:
    "Could not verify your Google account. Please try again.",
  db_upsert:
    "The connection could not be saved due to a server error. Please try again.",
};

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

const SYNC_BADGE: Record<
  "IDLE" | "SYNCING" | "ERROR",
  { label: string; className: string }
> = {
  IDLE:    { label: "Up to date",  className: "sync-badge sync-badge-idle" },
  SYNCING: { label: "Syncing…",    className: "sync-badge sync-badge-syncing" },
  ERROR:   { label: "Sync error",  className: "sync-badge sync-badge-error" },
};

export function GmailConnectionSection({
  workspaceId,
  connection,
  syncStatus,
  syncSettings,
  connectError,
  connectSuccess,
}: Props) {
  const [isPending, startTransition] = useTransition();

  function handleDisconnect() {
    startTransition(async () => {
      await disconnectGmailAction(workspaceId);
    });
  }

  const errorMessage = connectError
    ? (ERROR_MESSAGES[connectError] ?? "Connection failed. Please try again.")
    : null;

  const badge = syncStatus ? SYNC_BADGE[syncStatus.status] : null;

  return (
    <section className="settings-section">
      <h2>Gmail Inbox</h2>

      {connectSuccess && (
        <div className="alert alert-success">Gmail inbox connected successfully.</div>
      )}
      {errorMessage && (
        <div className="alert alert-error">{errorMessage}</div>
      )}

      {connection ? (
        <>
          <div className="gmail-connection-status">
            <div className="gmail-address">{connection.gmailAddress}</div>
            <div className="gmail-meta">
              Last verified: {formatDate(connection.lastVerifiedAt)}
            </div>

            {syncStatus !== null ? (
              <div className="sync-status-row">
                <span className="sync-status-label">Inbox sync</span>
                {badge && <span className={badge.className}>{badge.label}</span>}
                <span className="sync-status-time">
                  {syncStatus.lastSyncedAt
                    ? `Last synced ${formatDate(syncStatus.lastSyncedAt)}`
                    : "Not yet synced"}
                </span>
                {syncStatus.status === "ERROR" && syncStatus.errorMessage && (
                  <div className="sync-error-message">{syncStatus.errorMessage}</div>
                )}
              </div>
            ) : (
              <div className="sync-status-row">
                <span className="sync-status-label">Inbox sync</span>
                <span className="sync-status-time">Waiting for first sync…</span>
              </div>
            )}

            <button
              className="btn-danger"
              onClick={handleDisconnect}
              disabled={isPending}
              type="button"
            >
              {isPending ? "Disconnecting…" : "Disconnect Gmail"}
            </button>
          </div>

          <GmailSyncSettingsSection
            workspaceId={workspaceId}
            initialSettings={syncSettings ?? DEFAULT_SYNC_SETTINGS}
          />
        </>
      ) : (
        <div className="gmail-connection-empty">
          <p>No Gmail inbox connected to this workspace.</p>
          <a
            href={`/api/gmail/connect?workspaceId=${workspaceId}`}
            className="btn-primary"
          >
            Connect Gmail
          </a>
        </div>
      )}
    </section>
  );
}
