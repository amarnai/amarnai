"use client";

import { useState, useTransition } from "react";
import { disconnectGmailAction, type DisconnectOutcome } from "@/actions/gmail";
import type { GmailConnection, SyncStatus, GmailSyncSettings } from "@/lib/api";
import { GmailSyncSettingsSection } from "./GmailSyncSettingsSection";

const DEFAULT_SYNC_SETTINGS: GmailSyncSettings = {
  includeSpam: false,
  includePromotions: false,
  sortingPaused: false,
  routeBulkToOther: true,
  blacklistedSenderEmails: [],
};

type Props = {
  workspaceId: string;
  connection: GmailConnection;
  syncStatus: SyncStatus;
  syncSettings: GmailSyncSettings | null;
  connectError: string | null;
  connectSuccess: boolean;
};

const GOOGLE_PERMISSIONS_URL = "https://myaccount.google.com/permissions";

function GooglePermissionsLink() {
  return (
    <a href={GOOGLE_PERMISSIONS_URL} target="_blank" rel="noreferrer">
      Google Account permissions
    </a>
  );
}

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
  const [confirming, setConfirming] = useState(false);
  const [eraseData, setEraseData] = useState(false);
  const [outcome, setOutcome] = useState<DisconnectOutcome | null>(null);

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectGmailAction(workspaceId, { eraseData });
      setOutcome(result);
      setConfirming(false);
      setEraseData(false);
    });
  }

  const errorMessage = connectError
    ? (ERROR_MESSAGES[connectError] ?? "Connection failed. Please try again.")
    : null;

  const badge = syncStatus ? SYNC_BADGE[syncStatus.status] : null;
  const alsoConnectedIn = connection?.alsoConnectedIn ?? [];
  // sharedMailbox is cross-tenant (drives whether disconnecting revokes the
  // Google grant); alsoConnectedIn only lists workspaces this user can see.
  const sharedMailbox = connection?.sharedMailbox ?? false;
  const isShared = alsoConnectedIn.length > 0;
  const sharedNames = alsoConnectedIn.map((w) => w.name).join(", ");

  const disconnectWarning = !sharedMailbox ? (
    <>
      Stops syncing and revokes Amarnai&apos;s access to this mailbox. Synced
      email data is kept so you can reconnect later.
    </>
  ) : isShared ? (
    <>
      Disconnects this workspace. Amarnai keeps access because this mailbox is
      still connected in {sharedNames}.
    </>
  ) : (
    <>
      Disconnects this workspace. Amarnai keeps access because this mailbox is
      also connected elsewhere in Amarnai. To fully revoke access, remove
      Amarnai from your <GooglePermissionsLink />.
    </>
  );

  const erasedNote = outcome?.erased ? " Synced email data was erased." : null;

  return (
    <section className="settings-section">
      <h2>Gmail Inbox</h2>

      {connectSuccess && (
        <div className="alert alert-success">Gmail inbox connected successfully.</div>
      )}
      {errorMessage && (
        <div className="alert alert-error">{errorMessage}</div>
      )}

      {connection?.status === "ACTIVE" ? (
        <>
          <div className="gmail-connection-status">
            <div className="gmail-address">{connection.gmailAddress}</div>
            <div className="gmail-meta" suppressHydrationWarning>
              Last verified: {formatDate(connection.lastVerifiedAt)}
            </div>

            {isShared && (
              <div className="alert alert-info">
                This Gmail is also connected in {sharedNames}. Each workspace syncs and classifies it separately, which uses separate AI quota.
              </div>
            )}

            {syncStatus !== null ? (
              <div className="sync-status-row">
                <span className="sync-status-label">Inbox sync</span>
                {badge && <span className={badge.className}>{badge.label}</span>}
                <span className="sync-status-time" suppressHydrationWarning>
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

            {!confirming ? (
              <button
                className="btn-danger"
                onClick={() => setConfirming(true)}
                disabled={isPending}
                type="button"
              >
                Disconnect Gmail
              </button>
            ) : (
              <div className="account-delete-confirm">
                <p className="account-danger-warning">{disconnectWarning}</p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={eraseData}
                    onChange={(e) => setEraseData(e.target.checked)}
                    disabled={isPending}
                  />
                  Also erase synced email data
                </label>
                <div className="account-delete-actions">
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={handleDisconnect}
                    disabled={isPending}
                  >
                    {isPending ? "Disconnecting…" : "Yes, disconnect"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setConfirming(false); setEraseData(false); }}
                    disabled={isPending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <GmailSyncSettingsSection
            workspaceId={workspaceId}
            initialSettings={syncSettings ?? DEFAULT_SYNC_SETTINGS}
          />
        </>
      ) : connection?.status === "DISCONNECTED" ? (
        <div className="gmail-connection-status">
          <div className="gmail-address">{connection.gmailAddress}</div>
          {outcome ? (
            // Reports what the disconnect actually did, not what was predicted.
            outcome.sharedMailbox ? (
              <div className="alert alert-info">
                Disconnected from this workspace.{erasedNote} Amarnai still has
                access because this mailbox is connected in another workspace.
                To fully revoke access, remove Amarnai from your{" "}
                <GooglePermissionsLink />.
              </div>
            ) : outcome.revoked ? (
              <div className="alert alert-success">
                Disconnected. Amarnai&apos;s access to this mailbox was revoked
                at Google.{erasedNote}
              </div>
            ) : (
              <div className="alert alert-info">
                Disconnected.{erasedNote} Revocation at Google could not be
                confirmed. You can remove Amarnai from your{" "}
                <GooglePermissionsLink />.
              </div>
            )
          ) : (
            <div className="alert alert-error">
              Disconnected. Amarnai is no longer syncing this inbox.
            </div>
          )}
          <a
            href={`/api/gmail/connect?workspaceId=${workspaceId}`}
            className="btn-primary"
          >
            Reconnect Gmail
          </a>
        </div>
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
